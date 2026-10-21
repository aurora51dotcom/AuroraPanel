"""Applications — one-click web app installers (WordPress for now).

WordPress flow (runs as a background job with a live log):
  1. resolve the target: new domain, new subdomain, existing site (+ optional
     sub-folder) or any custom folder
  2. make sure PHP (the version Apache uses) has the extensions WordPress needs
  3. download https://wordpress.org/latest.zip and verify its SHA-1
  4. create a MariaDB database + user with a random password
  5. write wp-config.php with fresh salts
  6. optionally run WordPress's own installer (site title + admin account)
  7. fix ownership so Apache (www-data) can update plugins/themes

Installs are remembered in /var/lib/aurora/apps.json; existing WordPress
folders under /var/www are also detected.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import string
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from . import databases, jobs, sites

WP_URL = "https://wordpress.org/latest.zip"
REGISTRY = Path("/var/lib/aurora/apps.json")
SCAN_ROOTS = [Path("/var/www")]
WP_EXTS = {"mysqli": "mysql", "curl": "curl", "gd": "gd", "mbstring": "mbstring", "xml": "xml", "zip": "zip", "intl": "intl"}
REQUIRED_EXTS = {"mysqli"}


class AppError(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _run(argv, timeout=120, env=None):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env)


def _registry() -> list[dict]:
    try:
        return json.loads(REGISTRY.read_text())
    except (OSError, ValueError):
        return []


def _save_registry(items: list[dict]) -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(items, indent=2))


def apache_php() -> str | None:
    """PHP version Apache actually runs (mods-enabled/phpX.Y.load)."""
    for f in sorted(Path("/etc/apache2/mods-enabled").glob("php*.load")):
        m = re.match(r"php(\d+\.\d+)\.load", f.name)
        if m:
            return m.group(1)
    return None


def _php_bin(ver: str | None) -> str | None:
    if ver and shutil.which(f"php{ver}"):
        return shutil.which(f"php{ver}")
    return shutil.which("php")


def _php_modules(php: str) -> set[str]:
    r = _run([php, "-m"], 30)
    return {l.strip().lower() for l in r.stdout.splitlines() if l.strip() and not l.startswith("[")}


def _wp_version(path: Path) -> str | None:
    f = path / "wp-includes" / "version.php"
    try:
        m = re.search(r"\$wp_version\s*=\s*'([^']+)'", f.read_text(errors="replace"))
        return m.group(1) if m else None
    except OSError:
        return None


def _wp_db(path: Path) -> str | None:
    try:
        m = re.search(r"define\(\s*'DB_NAME'\s*,\s*'([^']+)'", (path / "wp-config.php").read_text(errors="replace"))
        return m.group(1) if m else None
    except OSError:
        return None


def _slug(s: str, n: int = 20) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:n] or "site"


def _pw(n: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits + "-_.,!@#^*()"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _db_pw(n: int = 28) -> str:
    # databases._password forbids quotes/backslash/semicolon; keep it simple.
    alphabet = string.ascii_letters + string.digits + "-_.@#^*()+="
    return "".join(secrets.choice(alphabet) for _ in range(n))


# --------------------------------------------------------------------------- #
# listing
# --------------------------------------------------------------------------- #
def status() -> dict:
    ver = apache_php()
    php = _php_bin(ver)
    mods = _php_modules(php) if php else set()
    installed = []
    seen = set()
    for it in _registry():
        p = Path(it["path"])
        if p.exists():
            it = {**it, "version": _wp_version(p) or it.get("version"), "exists": True}
        else:
            it = {**it, "exists": False}
        seen.add(str(p))
        installed.append(it)
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for cfg in list(root.glob("*/wp-config.php")) + list(root.glob("*/*/wp-config.php")) + list(root.glob("*/*/*/wp-config.php")):
            p = cfg.parent
            if str(p) in seen:
                continue
            seen.add(str(p))
            installed.append({"app": "wordpress", "path": str(p), "url": None, "db": _wp_db(p),
                              "version": _wp_version(p), "detected": True, "exists": True})
    try:
        site_list = sites.list_sites().get("sites", [])
    except Exception:
        site_list = []
    return {
        "php_version": ver, "php_bin": php, "php_modules": sorted(m for m in mods if m in WP_EXTS),
        "php_missing": sorted(e for e in WP_EXTS if e not in mods),
        "mysql": databases.mysql_available(),
        "installed": installed,
        "sites": [{"server_name": s["server_name"], "docroot": s["docroot"], "ssl": s["ssl"], "system": s["system"]}
                  for s in site_list],
    }


# --------------------------------------------------------------------------- #
# WordPress install
# --------------------------------------------------------------------------- #
def _resolve_target(opts: dict, log) -> tuple[Path, str, bool]:
    """Returns (install dir, public URL, created_site)."""
    mode = opts.get("mode")
    sub = (opts.get("subfolder") or "").strip().strip("/")
    if sub and not re.match(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$", sub) or ".." in sub:
        raise AppError("Sub-folder may only contain letters, digits, . _ - and /")
    if mode in ("new_domain", "subdomain"):
        if mode == "subdomain":
            label = (opts.get("subdomain") or "").strip().lower()
            parent = (opts.get("parent") or "").strip().lower()
            if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", label):
                raise AppError("Enter a valid subdomain label, e.g. blog")
            name = f"{label}.{parent}"
        else:
            name = (opts.get("domain") or "").strip().lower()
        ssl = bool(opts.get("ssl"))
        settings = {"server_name": name, "ssl": "selfsigned" if ssl else "none", "force_https": ssl,
                    "aliases": ["www." + name] if mode == "new_domain" and opts.get("www", True) and not name.startswith("www.") else []}
        log(f"• Creating Apache site {name}…")
        try:
            r = sites.create_site(settings)
        except sites.SiteError as exc:
            raise AppError(str(exc))
        base = Path(r["docroot"])
        idx = base / "index.html"
        if idx.exists() and "AuroraPanel" in idx.read_text(errors="replace"):
            idx.unlink()  # placeholder page would shadow index.php
        scheme = "https" if ssl else "http"
        path = base / sub if sub else base
        return path, f"{scheme}://{name}" + (f"/{sub}" if sub else ""), True
    if mode == "existing":
        name = (opts.get("site") or "").strip().lower()
        try:
            s = sites.get_site(name)["settings"]
        except sites.SiteError as exc:
            raise AppError(str(exc))
        base = Path(s["docroot"])
        scheme = "https" if s["ssl"] != "none" else "http"
        path = base / sub if sub else base
        return path, f"{scheme}://{s['server_name']}" + (f"/{sub}" if sub else ""), False
    if mode == "folder":
        p = (opts.get("path") or "").strip()
        if not p.startswith("/") or ".." in p:
            raise AppError("Folder must be an absolute path")
        url = (opts.get("url") or "").strip().rstrip("/")
        if not re.match(r"^https?://[^\s\"'<>]+$", url):
            raise AppError("Enter the URL this folder will be served at")
        return Path(p), url, False
    raise AppError("Choose where to install")


def _check_empty(path: Path, overwrite: bool) -> None:
    if not path.exists():
        return
    items = [p for p in path.iterdir() if p.name not in ("index.html", ".well-known")]
    if (path / "wp-config.php").exists():
        raise AppError(f"WordPress is already installed in {path}")
    if items and not overwrite:
        raise AppError(f"{path} is not empty ({len(items)} items). Pick another folder or tick “install anyway”.")


def _ensure_php(ver: str | None, log) -> str:
    php = _php_bin(ver)
    if not php:
        raise AppError("PHP is not installed — install Apache PHP first (Software → Select PHP Version)")
    mods = _php_modules(php)
    missing = [e for e in WP_EXTS if e not in mods]
    if missing:
        pkgs = [f"php{ver}-{WP_EXTS[e]}" if ver else f"php-{WP_EXTS[e]}" for e in missing]
        log(f"• Installing PHP extensions: {', '.join(pkgs)}…")
        env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
        r = _run(["apt-get", "-y", "install", *pkgs], 600, env)
        if r.returncode != 0:
            still = [e for e in REQUIRED_EXTS if e not in _php_modules(php)]
            if still:
                raise AppError("Couldn't install required PHP extensions:\n" + (r.stderr or r.stdout)[-800:])
            log("  (some optional extensions weren't available — continuing)")
        _run(["systemctl", "reload", "apache2"])
    else:
        log(f"• PHP {ver or ''} has everything WordPress needs")
    return php


def _download(log) -> Path:
    log(f"• Downloading {WP_URL}…")
    tmp = Path(tempfile.mkdtemp(prefix="aurora-wp-"))
    zpath = tmp / "latest.zip"
    req = urllib.request.Request(WP_URL, headers={"User-Agent": "AuroraPanel"})
    with urllib.request.urlopen(req, timeout=60) as r, open(zpath, "wb") as fh:
        total = int(r.headers.get("Content-Length") or 0)
        got, last = 0, 0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            got += len(chunk)
            if total and got * 100 // total >= last + 25:
                last = got * 100 // total
                log(f"  {last}% of {total // 1048576} MB")
    try:
        with urllib.request.urlopen(WP_URL + ".sha1", timeout=20) as r:
            want = r.read().decode().strip().split()[0]
        have = hashlib.sha1(zpath.read_bytes()).hexdigest()
        if want != have:
            raise AppError("Downloaded file failed the SHA-1 check — try again")
        log("  checksum OK")
    except AppError:
        raise
    except Exception:
        log("  (couldn't fetch checksum — skipping verification)")
    return zpath


def _extract(zpath: Path, dest: Path, log) -> None:
    log(f"• Extracting into {dest}…")
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            name = info.filename
            if not name.startswith("wordpress/") or name == "wordpress/":
                continue
            rel = name[len("wordpress/"):]
            target = (dest / rel).resolve()
            if dest.resolve() not in target.parents and target != dest.resolve():
                continue  # zip-slip guard
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
    shutil.rmtree(zpath.parent, ignore_errors=True)
    stale = dest / "index.html"
    if stale.exists() and "AuroraPanel" in stale.read_text(errors="replace"):
        stale.unlink()


def _create_db(base: str, log) -> tuple[str, str, str]:
    existing = {d["name"] for d in databases.mysql_databases()}
    name = f"wp_{_slug(base, 40)}"
    i = 2
    while name in existing:
        name = f"wp_{_slug(base, 36)}_{i}"
        i += 1
    user, pw = name[:32], _db_pw()
    log(f"• Creating database {name} and user {user}…")
    databases._mysql(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
    databases._mysql(f"CREATE USER '{user}'@'localhost' IDENTIFIED BY '{pw}';")
    databases._mysql(f"GRANT ALL PRIVILEGES ON `{name}`.* TO '{user}'@'localhost'; FLUSH PRIVILEGES;")
    return name, user, pw


def _write_config(dest: Path, db: str, user: str, pw: str, url: str, log) -> None:
    log("• Writing wp-config.php (fresh security keys)…")
    sample = (dest / "wp-config-sample.php").read_text()
    repl = {"database_name_here": db, "username_here": user, "password_here": pw}
    for k, v in repl.items():
        sample = sample.replace(f"'{k}'", "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'")
    salt_chars = string.ascii_letters + string.digits + "!@#$%^&*()-_[]{}<>~+=,.;:/?|"
    sample = re.sub(r"'put your unique phrase here'",
                    lambda _: "'" + "".join(secrets.choice(salt_chars) for _ in range(64)) + "'", sample)
    extra = ("\n/* Added by AuroraPanel */\n"
             "define( 'FS_METHOD', 'direct' );\n"
             "if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https' ) { $_SERVER['HTTPS'] = 'on'; }\n")
    sample = sample.replace("/* That's all, stop editing!", extra + "\n/* That's all, stop editing!")
    (dest / "wp-config.php").write_text(sample)


_WP_INSTALL_PHP = r"""<?php
define('WP_INSTALLING', true);
$u = parse_url(getenv('AP_URL'));
$_SERVER['HTTP_HOST'] = $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
$_SERVER['REQUEST_URI'] = isset($u['path']) ? $u['path'] : '/';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
if ($u['scheme'] === 'https') { $_SERVER['HTTPS'] = 'on'; }
require getenv('AP_DIR') . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
if (is_blog_installed()) { fwrite(STDERR, "already installed\n"); exit(2); }
$r = wp_install(getenv('AP_TITLE'), getenv('AP_USER'), getenv('AP_EMAIL'), (int) getenv('AP_PUBLIC'), '', wp_slash(getenv('AP_PASS')), getenv('AP_LANG') ?: '');
update_option('siteurl', getenv('AP_URL'));
update_option('home', getenv('AP_URL'));
echo "user_id=" . $r['user_id'] . "\n";
"""


def _run_wp_install(php: str, dest: Path, url: str, o: dict, log) -> None:
    log(f"• Running WordPress installer (admin user “{o['admin_user']}”)…")
    with tempfile.NamedTemporaryFile("w", suffix=".php", delete=False) as fh:
        fh.write(_WP_INSTALL_PHP)
    env = {**os.environ, "AP_DIR": str(dest), "AP_URL": url, "AP_TITLE": o["title"], "AP_USER": o["admin_user"],
           "AP_EMAIL": o["admin_email"], "AP_PASS": o["admin_pass"], "AP_PUBLIC": "1" if o.get("public", True) else "0",
           "AP_LANG": o.get("language") or ""}
    try:
        r = _run([php, fh.name], 180, env)
    finally:
        os.unlink(fh.name)
    if r.returncode != 0:
        raise AppError("WordPress installer failed:\n" + (r.stderr or r.stdout)[-800:])


def _validate(opts: dict) -> dict:
    o = dict(opts or {})
    o["setup"] = bool(o.get("setup", True))
    if o["setup"]:
        o["title"] = (o.get("title") or "").strip() or "My WordPress Site"
        o["admin_user"] = (o.get("admin_user") or "").strip()
        if not re.match(r"^[A-Za-z0-9_.@-]{3,60}$", o["admin_user"]):
            raise AppError("Admin username: 3–60 letters, digits, _ . @ -")
        if o["admin_user"].lower() == "admin":
            raise AppError("Please don't use “admin” as the username — it's the first thing bots try")
        o["admin_email"] = (o.get("admin_email") or "").strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", o["admin_email"]):
            raise AppError("Enter a valid admin email")
        o["admin_pass"] = o.get("admin_pass") or ""
        if len(o["admin_pass"]) < 10:
            raise AppError("Admin password must be at least 10 characters")
    return o


def install_wordpress(opts: dict) -> jobs.Job:
    if not databases.mysql_available():
        raise AppError("MariaDB/MySQL is not installed — install it from Databases first")
    if not shutil.which("apache2ctl"):
        raise AppError("Apache is not installed")
    o = _validate(opts)
    # Resolve the target up-front for errors that should show immediately.
    if o.get("mode") == "existing":
        _resolve_target(o, lambda *_: None)

    def work(log):
        t0 = time.time()
        ver = apache_php()
        php = _ensure_php(ver, log)
        dest, url, created = _resolve_target(o, log)
        _check_empty(dest, bool(o.get("overwrite")))
        zpath = _download(log)
        _extract(zpath, dest, log)
        db, user, pw = _create_db(url.split("://", 1)[1].replace("/", "_"), log)
        _write_config(dest, db, user, pw, url, log)
        log("• Setting ownership to www-data…")
        _run(["chown", "-R", "www-data:www-data", str(dest)])
        _run(["find", str(dest), "-type", "d", "-exec", "chmod", "755", "{}", "+"])
        _run(["find", str(dest), "-type", "f", "-exec", "chmod", "644", "{}", "+"])
        os.chmod(dest / "wp-config.php", 0o640)
        if o["setup"]:
            _run_wp_install(php, dest, url, o, log)
        items = [i for i in _registry() if i.get("path") != str(dest)]
        entry = {"app": "wordpress", "path": str(dest), "url": url, "db": db, "db_user": user,
                 "version": _wp_version(dest), "installed": int(time.time()), "created_site": created,
                 "admin_user": o.get("admin_user") if o["setup"] else None}
        _save_registry(items + [entry])
        log(f"✔ WordPress {entry['version']} installed in {int(time.time() - t0)}s")
        log(f"  Site:  {url}/")
        log(f"  Admin: {url}/wp-admin/" if o["setup"] else f"  Finish setup: {url}/wp-admin/install.php")
        return entry

    return jobs.launch_fn(f"WordPress → {o.get('domain') or o.get('site') or o.get('path') or o.get('subdomain', '')}", work)


def uninstall(path: str, drop_db: bool = True, remove_site: bool = False) -> dict:
    p = Path(path)
    items = _registry()
    entry = next((i for i in items if i["path"] == path), None)
    if not (p / "wp-config.php").exists() and not entry:
        raise AppError("No WordPress install found there")
    if str(p) in ("/", "/var/www", "/var/www/html", "/root", "/home") or not str(p).startswith("/var/www/"):
        raise AppError("For safety, only installs under /var/www/<site> can be removed here")
    db = (entry or {}).get("db") or _wp_db(p)
    user = (entry or {}).get("db_user")
    trash = Path("/var/lib/aurora/trash")
    trash.mkdir(parents=True, exist_ok=True)
    moved = None
    if p.exists():
        moved = trash / f"{p.name}-{int(time.time())}"
        shutil.move(str(p), moved)
        p.mkdir(parents=True, exist_ok=True)   # keep the docroot so Apache stays happy
        _run(["chown", "www-data:www-data", str(p)])
    if drop_db and db and re.match(r"^[A-Za-z0-9_]{1,64}$", db):
        databases._mysql(f"DROP DATABASE IF EXISTS `{db}`;")
        if user and re.match(r"^[A-Za-z0-9_]{1,32}$", user):
            databases._mysql(f"DROP USER IF EXISTS '{user}'@'localhost';")
    if remove_site and entry and entry.get("created_site"):
        host = entry["url"].split("://", 1)[1].split("/")[0]
        try:
            sites.remove_site(host)
        except sites.SiteError:
            pass
    _save_registry([i for i in items if i["path"] != path])
    return {"ok": True, "files_moved_to": str(moved) if moved else None, "db_dropped": bool(drop_db and db)}


def suggest_password() -> dict:
    return {"password": _pw()}
