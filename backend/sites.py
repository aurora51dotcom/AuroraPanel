"""Domains → per-site settings (cPanel "Manage the Domain").

Each Aurora-managed site is one Apache conf in sites-available, regenerated from
a settings dict that is embedded in the file itself as a JSON comment:

    # aurora-settings: {"server_name": "...", ...}

Existing hand-written sites are *adopted*: their settings are inferred from the
conf, and on first save the original is kept as <conf>.aurora-bak.

Every write is checked with `apache2ctl configtest`; a failing config is rolled
back so a bad setting can never take Apache down.
"""
from __future__ import annotations

import json
import platform
import re
import shutil
import subprocess
from pathlib import Path

from . import jobs, sslcerts

IS_LINUX = platform.system() == "Linux"
APACHE = Path("/etc/apache2")
AVAIL = APACHE / "sites-available"
ENABLED = APACHE / "sites-enabled"
SSL_DIR = APACHE / "ssl" / "aurora"
LE_LIVE = Path("/etc/letsencrypt/live")
DEFAULT_DOCROOT_BASE = Path("/var/www")
SYSTEM_CONFS = {"000-default.conf", "default-ssl.conf"}
MARK = "# aurora-settings:"
_HOST = re.compile(r"^(?=.{1,253}$)(\*\.)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$")

DEFAULTS = {
    "server_name": "", "aliases": [], "docroot": "", "enabled": True,
    "www": "none",                       # none | force_www | force_bare
    "ssl": "none",                       # none | selfsigned | letsencrypt | custom
    "cert": "", "key": "", "chain": "",
    "force_https": False, "hsts": False,
    "redirect_url": "", "redirect_code": 301,
    "indexes": False, "allow_override": True,
    "gzip": True, "cache_static": False, "security_headers": True,
    "maintenance": False, "custom": "",
}


class SiteError(RuntimeError):
    pass


def _require():
    if not (IS_LINUX and shutil.which("apache2ctl")):
        raise SiteError("Apache is not available on this host")


def _run(argv, timeout=30):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


# --------------------------------------------------------------------------- #
# Reading existing confs
# --------------------------------------------------------------------------- #
def _blocks(text: str) -> list[dict]:
    """Split a conf into VirtualHost blocks with the directives we care about."""
    out = []
    for m in re.finditer(r"<VirtualHost\s+([^>]+)>(.*?)</VirtualHost>", text, re.S | re.I):
        addr, body = m.group(1), m.group(2)
        port = (re.search(r":(\d+)", addr) or [None, "80"])[1]

        def d(name):
            mm = re.search(rf"(?im)^\s*{name}\s+(.+?)\s*$", body)
            return mm.group(1).strip().strip('"') if mm else None
        out.append({
            "port": int(port), "server_name": d("ServerName"),
            "aliases": " ".join(re.findall(r"(?im)^\s*ServerAlias\s+(.+?)\s*$", body)).split(),
            "docroot": d("DocumentRoot"), "ssl": bool(re.search(r"(?im)^\s*SSLEngine\s+on", body)),
            "cert": d("SSLCertificateFile"), "key": d("SSLCertificateKeyFile"), "chain": d("SSLCertificateChainFile"),
            "https_redirect": bool(re.search(r"(?im)^\s*(RewriteRule\s+\S+\s+https://|Redirect\s+(permanent|301)?\s*/\s+https://)", body)),
            "redirect": re.search(r"(?im)^\s*Redirect\s+(301|302|permanent|temp)?\s*/\s+(\S+)", body),
            "indexes": bool(re.search(r"(?im)^\s*Options\s+.*(?<![-\w])\+?Indexes", body)),
            "allow_override": bool(re.search(r"(?im)^\s*AllowOverride\s+All", body)),
            "hsts": "Strict-Transport-Security" in body,
        })
    return out


def _settings_from_conf(path: Path) -> dict:
    text = path.read_text(errors="replace")
    for line in text.splitlines()[:5]:
        if line.startswith(MARK):
            try:
                return {**DEFAULTS, **json.loads(line[len(MARK):]), "_managed": True}
            except ValueError:
                break
    blocks = _blocks(text)
    if not blocks:
        raise SiteError(f"No VirtualHost found in {path.name}")
    http = next((b for b in blocks if not b["ssl"]), None)
    https = next((b for b in blocks if b["ssl"]), None)
    main = https or http
    s = dict(DEFAULTS)
    s.update(server_name=(main["server_name"] or path.stem), aliases=main["aliases"],
             docroot=main["docroot"] or "", indexes=main["indexes"], allow_override=main["allow_override"],
             gzip=False, security_headers=False, hsts=bool(https and https["hsts"]))
    if https:
        le = str(LE_LIVE) in (https["cert"] or "")
        s.update(ssl="letsencrypt" if le else "custom", cert=https["cert"] or "", key=https["key"] or "", chain=https["chain"] or "")
    if http and http["https_redirect"]:
        s["force_https"] = True
    elif main["redirect"] and not main["redirect"].group(2).startswith("https://%{"):
        code = main["redirect"].group(1) or "302"
        s.update(redirect_url=main["redirect"].group(2), redirect_code=301 if code in ("301", "permanent") else 302)
    s["_managed"] = False
    return s


def _conf_for(name: str) -> Path | None:
    name = name.lower()
    for f in sorted(AVAIL.glob("*.conf")):
        try:
            for b in _blocks(f.read_text(errors="replace")):
                if (b["server_name"] or "").lower() == name:
                    return f
        except OSError:
            continue
    return None


def _cert_info(s: dict) -> dict | None:
    path = s.get("cert")
    if s.get("ssl") == "selfsigned":
        path = str(SSL_DIR / f"{_slug(s['server_name'])}.crt")
    elif s.get("ssl") == "letsencrypt":
        path = str(LE_LIVE / s["server_name"] / "fullchain.pem")
    if not path or not Path(path).exists():
        return None
    return sslcerts._inspect(Path(path))


def list_sites() -> dict:
    if not (IS_LINUX and AVAIL.exists()):
        return {"supported": False, "sites": []}
    sites = []
    for f in sorted(AVAIL.glob("*.conf")):
        try:
            s = _settings_from_conf(f)
        except (SiteError, OSError):
            continue
        cert = _cert_info(s) if s["ssl"] != "none" else None
        sites.append({
            "server_name": s["server_name"], "aliases": s["aliases"], "docroot": s["docroot"],
            "conf": f.name, "enabled": (ENABLED / f.name).exists(), "managed": s["_managed"],
            "system": f.name in SYSTEM_CONFS, "ssl": s["ssl"], "force_https": s["force_https"],
            "redirect_url": s["redirect_url"], "maintenance": s["maintenance"],
            "cert_expires": cert.get("expires") if cert else None,
            "cert_self_signed": cert.get("self_signed") if cert else None,
        })
    return {"supported": True, "sites": sites, "certbot": bool(shutil.which("certbot"))}


def get_site(name: str) -> dict:
    _require()
    conf = _conf_for(name)
    if not conf:
        raise SiteError("No site found with that name")
    s = _settings_from_conf(conf)
    cert = _cert_info(s) if s["ssl"] != "none" else None
    return {"settings": {k: v for k, v in s.items() if not k.startswith("_")}, "managed": s["_managed"],
            "conf": conf.name, "system": conf.name in SYSTEM_CONFS, "enabled": (ENABLED / conf.name).exists(),
            "cert": cert, "certbot": bool(shutil.which("certbot")),
            "le_available": (LE_LIVE / s["server_name"] / "fullchain.pem").exists(),
            "config_text": conf.read_text(errors="replace")[:30000]}


# --------------------------------------------------------------------------- #
# Validation + rendering
# --------------------------------------------------------------------------- #
def _slug(name: str) -> str:
    return name.lower().replace("*", "wildcard")


def _clean(settings: dict) -> dict:
    s = {**DEFAULTS, **{k: v for k, v in (settings or {}).items() if k in DEFAULTS}}
    s["server_name"] = (s["server_name"] or "").strip().lower()
    if not _HOST.match(s["server_name"]):
        raise SiteError("Enter a valid domain, e.g. example.com")
    aliases = []
    for a in s["aliases"] or []:
        a = str(a).strip().lower()
        if not a or a == s["server_name"] or a in aliases:
            continue
        if not _HOST.match(a):
            raise SiteError(f"Invalid alias: {a}")
        aliases.append(a)
    bare = s["server_name"][4:] if s["server_name"].startswith("www.") else s["server_name"]
    if s["www"] in ("force_www", "force_bare"):
        other = bare if s["server_name"].startswith("www.") else "www." + bare
        if other not in aliases:
            aliases.append(other)
    s["aliases"] = aliases
    if s["www"] not in ("none", "force_www", "force_bare"):
        raise SiteError("Invalid www setting")
    root = (s["docroot"] or "").strip() or str(DEFAULT_DOCROOT_BASE / _slug(s["server_name"]))
    if not root.startswith("/") or ".." in root or any(c in root for c in "\n\"'<>"):
        raise SiteError("Document root must be an absolute path")
    s["docroot"] = root.rstrip("/") or "/"
    if s["ssl"] not in ("none", "selfsigned", "letsencrypt", "custom"):
        raise SiteError("Invalid SSL mode")
    if s["ssl"] == "none" and (s["force_https"] or s["hsts"]):
        raise SiteError("Force HTTPS / HSTS need an SSL certificate — pick one under HTTPS first")
    if s["ssl"] == "letsencrypt" and not (LE_LIVE / s["server_name"] / "fullchain.pem").exists():
        raise SiteError("No Let's Encrypt certificate yet — use “Issue certificate” first")
    if s["ssl"] == "custom":
        for k in ("cert", "key"):
            p = (s[k] or "").strip()
            if not p or not Path(p).is_file():
                raise SiteError(f"Custom SSL {k} file not found: {p or '(empty)'}")
        if s["chain"] and not Path(s["chain"]).is_file():
            raise SiteError(f"Chain file not found: {s['chain']}")
    url = (s["redirect_url"] or "").strip()
    if url and not re.match(r"^https?://[^\s\"'<>]+$", url):
        raise SiteError("Redirect must be a full http(s):// URL")
    s["redirect_url"] = url
    s["redirect_code"] = 302 if int(s["redirect_code"] or 301) == 302 else 301
    for k in ("enabled", "force_https", "hsts", "indexes", "allow_override", "gzip", "cache_static", "security_headers", "maintenance"):
        s[k] = bool(s[k])
    custom = s["custom"] or ""
    if re.search(r"(?i)</?\s*VirtualHost", custom):
        raise SiteError("Custom directives can't open or close a VirtualHost")
    s["custom"] = custom.strip()[:8000]
    return s


def _ssl_paths(s: dict) -> tuple[str, str, str]:
    if s["ssl"] == "selfsigned":
        return str(SSL_DIR / f"{_slug(s['server_name'])}.crt"), str(SSL_DIR / f"{_slug(s['server_name'])}.key"), ""
    if s["ssl"] == "letsencrypt":
        d = LE_LIVE / s["server_name"]
        return str(d / "fullchain.pem"), str(d / "privkey.pem"), ""
    return s["cert"], s["key"], s["chain"]


_MAINT = ('"<!doctype html><title>Maintenance</title><body style=\'font-family:system-ui;background:#0b0a0a;'
          'color:#f4efeb;display:grid;place-items:center;height:100vh;margin:0\'><div style=\'text-align:center\'>'
          '<h1>Be right back</h1><p>We are doing some maintenance. Please check again soon.</p></div>"')


def _content(s: dict, scheme: str) -> list[str]:
    name, root, esc = s["server_name"], s["docroot"], re.escape(s["server_name"])
    L = [f"    <Directory {root}>",
         f"        Options {'+' if s['indexes'] else '-'}Indexes +FollowSymLinks",
         f"        AllowOverride {'All' if s['allow_override'] else 'None'}",
         "        Require all granted",
         "    </Directory>"]
    rw = []
    bare = name[4:] if name.startswith("www.") else name
    if s["www"] == "force_www":
        rw += [f"    RewriteCond %{{HTTP_HOST}} ^{re.escape(bare)}$ [NC]",
               f"    RewriteRule ^ {scheme}://www.{bare}%{{REQUEST_URI}} [R=301,L]"]
    elif s["www"] == "force_bare":
        rw += [f"    RewriteCond %{{HTTP_HOST}} ^www\\.{re.escape(bare)}$ [NC]",
               f"    RewriteRule ^ {scheme}://{bare}%{{REQUEST_URI}} [R=301,L]"]
    if s["maintenance"]:
        rw += ["    RewriteCond %{REQUEST_URI} !^/\\.well-known/",
               "    RewriteRule ^ - [R=503,L]"]
        L.append(f"    ErrorDocument 503 {_MAINT}")
    if rw:
        L += ["    RewriteEngine On"] + rw
    if s["redirect_url"]:
        L.append(f"    Redirect {s['redirect_code']} / {s['redirect_url']}")
    if s["gzip"]:
        L += ["    <IfModule mod_deflate.c>",
              "        AddOutputFilterByType DEFLATE text/html text/plain text/css text/xml application/xml application/javascript application/json image/svg+xml",
              "    </IfModule>"]
    if s["cache_static"]:
        L += ["    <IfModule mod_expires.c>", "        ExpiresActive On",
              '        ExpiresByType image/* "access plus 1 month"',
              '        ExpiresByType font/* "access plus 1 month"',
              '        ExpiresByType text/css "access plus 1 week"',
              '        ExpiresByType application/javascript "access plus 1 week"',
              "    </IfModule>"]
    if s["security_headers"]:
        L += ["    <IfModule mod_headers.c>",
              '        Header always set X-Frame-Options "SAMEORIGIN"',
              '        Header always set X-Content-Type-Options "nosniff"',
              '        Header always set Referrer-Policy "strict-origin-when-cross-origin"',
              "    </IfModule>"]
    if scheme == "https" and s["hsts"]:
        L += ['    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"']
    slug = _slug(name)
    L += [f"    ErrorLog ${{APACHE_LOG_DIR}}/{slug}-error.log",
          f"    CustomLog ${{APACHE_LOG_DIR}}/{slug}-access.log combined"]
    if s["custom"]:
        L += ["    # --- custom directives ---"] + ["    " + ln for ln in s["custom"].splitlines()]
    return L


def render(s: dict) -> str:
    head = [f"<VirtualHost *:80>", f"    ServerName {s['server_name']}"]
    if s["aliases"]:
        head.append(f"    ServerAlias {' '.join(s['aliases'])}")
    head.append(f"    DocumentRoot {s['docroot']}")
    out = ["# Managed by AuroraPanel — change it in Domains → Manage; manual edits get overwritten.",
           MARK + " " + json.dumps(s, separators=(",", ":")), ""]
    if s["force_https"] and s["ssl"] != "none":
        out += head + [f"    <Directory {s['docroot']}>", "        Require all granted", "    </Directory>",
                       "    RewriteEngine On",
                       "    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/",
                       "    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]",
                       "</VirtualHost>"]
    else:
        out += head + _content(s, "http") + ["</VirtualHost>"]
    if s["ssl"] != "none":
        cert, key, chain = _ssl_paths(s)
        out += ["", "<IfModule mod_ssl.c>", head[0].replace(":80", ":443")] + head[1:] + [
            "    SSLEngine on", f"    SSLCertificateFile {cert}", f"    SSLCertificateKeyFile {key}"]
        if chain:
            out.append(f"    SSLCertificateChainFile {chain}")
        out += _content(s, "https") + ["</VirtualHost>", "</IfModule>"]
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------- #
# Writing
# --------------------------------------------------------------------------- #
def _ensure_selfsigned(s: dict) -> None:
    crt, key, _ = _ssl_paths(s)
    if Path(crt).exists() and Path(key).exists():
        return
    SSL_DIR.mkdir(parents=True, exist_ok=True)
    san = ",".join(f"DNS:{n}" for n in [s["server_name"], *s["aliases"]])
    r = _run(["openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "825",
              "-keyout", key, "-out", crt, "-subj", f"/CN={s['server_name']}", "-addext", f"subjectAltName={san}"], 60)
    if r.returncode != 0:
        raise SiteError(r.stderr.strip() or "openssl failed")
    Path(key).chmod(0o600)


def _needed_mods(s: dict) -> list[str]:
    mods = ["rewrite"]
    if s["ssl"] != "none":
        mods.append("ssl")
    if s["security_headers"] or s["hsts"]:
        mods.append("headers")
    if s["gzip"]:
        mods.append("deflate")
    if s["cache_static"]:
        mods.append("expires")
    return mods


def _apply(conf: Path, text: str, enabled: bool, mods: list[str]) -> dict:
    """Write conf, configtest, enable/disable, reload — or roll back."""
    old = conf.read_text() if conf.exists() else None
    for m in mods:
        if not (APACHE / "mods-enabled" / f"{m}.load").exists():
            _run(["a2enmod", "-q", m])
    conf.write_text(text, encoding="utf-8")
    was_enabled = (ENABLED / conf.name).exists()
    if enabled and not was_enabled:
        _run(["a2ensite", "-q", conf.name])
    if not enabled and was_enabled:
        _run(["a2dissite", "-q", conf.name])
    test = _run(["apache2ctl", "configtest"])
    if test.returncode != 0:
        if old is None:
            _run(["a2dissite", "-q", conf.name])
            conf.unlink(missing_ok=True)
        else:
            conf.write_text(old, encoding="utf-8")
            if was_enabled and not (ENABLED / conf.name).exists():
                _run(["a2ensite", "-q", conf.name])
        err = "\n".join(l for l in (test.stderr + test.stdout).splitlines() if "AH00558" not in l).strip()
        raise SiteError("Apache rejected the config, nothing was changed:\n" + err[:1500])
    r = _run(["systemctl", "reload", "apache2"])
    if r.returncode != 0:
        _run(["systemctl", "restart", "apache2"])
    return {"ok": True}


def _ensure_docroot(s: dict) -> None:
    root = Path(s["docroot"])
    if root.exists():
        return
    root.mkdir(parents=True, exist_ok=True)
    (root / "index.html").write_text(
        f"<!doctype html><meta charset=utf-8><title>{s['server_name']}</title>"
        "<body style='font-family:system-ui;background:#0b0a0a;color:#f4efeb;display:grid;"
        "place-items:center;height:100vh;margin:0'><div style='text-align:center'>"
        f"<h1 style='color:#ff8a33'>{s['server_name']}</h1><p>New site created by AuroraPanel.</p></div>",
        encoding="utf-8")
    _run(["chown", "-R", "www-data:www-data", str(root)])


def create_site(settings: dict) -> dict:
    _require()
    s = _clean(settings)
    if _conf_for(s["server_name"]):
        raise SiteError("A site with that name already exists")
    conf = AVAIL / f"{_slug(s['server_name'])}.conf"
    if conf.exists():
        raise SiteError(f"{conf.name} already exists")
    _ensure_docroot(s)
    if s["ssl"] == "selfsigned":
        _ensure_selfsigned(s)
    _apply(conf, render(s), s["enabled"], _needed_mods(s))
    return {"ok": True, "server_name": s["server_name"], "docroot": s["docroot"]}


def save_site(original_name: str, settings: dict) -> dict:
    _require()
    conf = _conf_for(original_name)
    if not conf:
        raise SiteError("No site found with that name")
    if conf.name in SYSTEM_CONFS:
        raise SiteError("System default sites are read-only here")
    s = _clean(settings)
    if s["server_name"] != original_name.lower() and _conf_for(s["server_name"]):
        raise SiteError("Another site already uses that name")
    managed = _settings_from_conf(conf).get("_managed")
    if not managed:
        bak = conf.with_name(conf.name + ".aurora-bak")
        if not bak.exists():
            shutil.copy2(conf, bak)
    _ensure_docroot(s)
    if s["ssl"] == "selfsigned":
        _ensure_selfsigned(s)
    _apply(conf, render(s), s["enabled"], _needed_mods(s))
    return {"ok": True, "adopted": not managed}


def quick_toggle(name: str, key: str, value: bool) -> dict:
    """List-page switches (Force HTTPS, enabled, maintenance)."""
    if key not in ("force_https", "enabled", "maintenance"):
        raise SiteError("Unsupported toggle")
    cur = get_site(name)
    s = cur["settings"]
    if key == "force_https" and value and s["ssl"] == "none":
        s["ssl"] = "selfsigned"   # needs *a* cert; upgrade to Let's Encrypt from Manage
    s[key] = bool(value)
    return save_site(name, s)


def remove_site(name: str) -> dict:
    _require()
    conf = _conf_for(name)
    if not conf:
        raise SiteError("No site found with that name")
    if conf.name in SYSTEM_CONFS:
        raise SiteError("Refusing to remove a system default site")
    _run(["a2dissite", "-q", conf.name])
    conf.unlink(missing_ok=True)
    _run(["systemctl", "reload", "apache2"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Let's Encrypt
# --------------------------------------------------------------------------- #
def certbot_install() -> jobs.Job:
    env = {"DEBIAN_FRONTEND": "noninteractive", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}
    return jobs.launch("install certbot", ["apt-get", "-y", "install", "certbot"], env=env)


def issue_letsencrypt(name: str, email: str, include_aliases: bool = True) -> jobs.Job:
    _require()
    if not shutil.which("certbot"):
        raise SiteError("certbot is not installed")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""):
        raise SiteError("A valid email is required for Let's Encrypt expiry notices")
    s = get_site(name)["settings"]
    names = [s["server_name"]] + ([a for a in s["aliases"] if not a.startswith("*")] if include_aliases else [])
    argv = ["certbot", "certonly", "--webroot", "-w", s["docroot"], "--non-interactive", "--agree-tos",
            "-m", email, "--keep-until-expiring", "--cert-name", s["server_name"]]
    for n in names:
        argv += ["-d", n]
    return jobs.launch(f"Let's Encrypt: {s['server_name']}", argv)
