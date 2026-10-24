"""Software a panel page needs, and a one-click install for it.

A Raspberry Pi set up for AuroraPanel usually already has Apache, PHP and MariaDB;
a fresh Ubuntu/Debian server has none of them. Pages ask status(ids) which of
their components are missing and offer install(id), a background job whose
apt progress drives an orange bar in the browser.

Only ids from COMPONENTS are accepted; package names never come from the client.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path

from . import jobs, sysapps

PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
PHP_PKGS = ["libapache2-mod-php", "php-cli", "php-mysql", "php-curl", "php-gd", "php-mbstring",
            "php-xml", "php-zip", "php-intl", "php-bcmath"]


class RequiresError(RuntimeError):
    pass


def _run(argv: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                              env={**os.environ, "PATH": PATH, "DEBIAN_FRONTEND": "noninteractive"})
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(argv, 1, "", str(e))


def _have(*pkgs: str) -> bool:
    st = sysapps._dpkg_status(list(pkgs))
    return all(st.get(p) for p in pkgs)


def _apache_php() -> bool:
    return any(Path("/etc/apache2/mods-enabled").glob("php*.load"))


def _ufw_allow(*ports: str) -> list[str]:
    """Open ports in ufw when it's active, so a new server is reachable from outside."""
    ufw = shutil.which("ufw", path=PATH)
    if not ufw or "Status: active" not in _run([ufw, "status"]).stdout:
        return []
    for p in ports:
        _run([ufw, "allow", p])
    return [f"• Firewall (ufw): allowed {', '.join(ports)}"]


def _enable(*units: str) -> list[str]:
    out = []
    for u in units:
        r = _run(["systemctl", "enable", "--now", u], 180)
        out.append(f"• Started {u}" if r.returncode == 0 else f"! Couldn't start {u}: {(r.stderr or r.stdout).strip()[-300:]}")
    return out


def _post_web() -> list[str]:
    out = []
    mods = ["rewrite", "headers", "expires", "ssl", "deflate"]
    r = _run(["a2enmod", "-q", *mods])
    out.append(f"• Apache modules on: {', '.join(mods)}" if r.returncode == 0 else f"! a2enmod: {r.stderr.strip()[-300:]}")
    web = Path("/var/www/html")
    web.mkdir(parents=True, exist_ok=True)
    _run(["chown", "www-data:www-data", str(web)])
    out += _enable("apache2")
    _run(["systemctl", "restart", "apache2"])
    out += _ufw_allow("80/tcp", "443/tcp")
    return out


def _mail():
    from . import mail
    return mail


def _collect(fn) -> list[str]:
    lines: list[str] = []
    fn(lines.append)
    return lines


def _preseed(*lines: str) -> list[str]:
    """Answer a package's install questions ahead of time (apt runs non-interactively)."""
    subprocess.run(["debconf-set-selections"], input="\n".join(lines) + "\n", text=True, capture_output=True,
                   timeout=60, env={**os.environ, "PATH": PATH})
    return []


def _bind_defaults() -> list[str]:
    from . import dnszones
    try:
        r = dnszones.apply_options()
    except dnszones.ZoneError as e:
        return [f"! {e}"]
    return ["• DNS server: lookups only for this machine, its local network and VPN; secondary DNS detected from NS records"
            + (f" ({', '.join(r['allowed'])})" if r.get("allowed") else "")]


def _post_certbot() -> list[str]:
    return _enable("certbot.timer")


COMPONENTS: dict[str, dict] = {
    "web": {
        "name": "Apache + PHP", "icon": "globe", "size": "about 35 MB",
        "desc": "The web server and PHP that websites, domains, .htaccess tools and the App Installer run on.",
        "pkgs": ["apache2", *PHP_PKGS, "unzip"],
        "check": lambda: _have("apache2") and _apache_php(),
        "post": _post_web,
    },
    "mariadb": {
        "name": "MariaDB", "icon": "database", "size": "about 40 MB",
        "desc": "MySQL-compatible database server for WordPress and most PHP apps.",
        "pkgs": ["mariadb-server", "mariadb-client"],
        "check": lambda: _have("mariadb-server") or _have("mysql-server"),
        "post": lambda: _enable("mariadb"),
    },
    "postgresql": {
        "name": "PostgreSQL", "icon": "database", "size": "about 50 MB",
        "desc": "Advanced SQL database used by Django, Rails, Nextcloud and many Python apps.",
        "pkgs": ["postgresql"],
        "check": lambda: bool(sysapps._pg_server_pkgs()),
        "post": lambda: _enable("postgresql"),
    },
    "ftp": {
        "name": "FTP server (vsftpd)", "icon": "folder", "size": "about 1 MB",
        "desc": "Lets you upload site files with FileZilla or any FTP client.",
        "pkgs": ["vsftpd"],
        "check": lambda: _have("vsftpd"),
        "post": lambda: _enable("vsftpd") + _ufw_allow("21/tcp", "40000:40100/tcp"),
    },
    "bind9": {
        "name": "BIND9 DNS server", "icon": "dns", "size": "about 5 MB",
        "desc": "Answers DNS for your own domains, so the Zone Editor's records go live.",
        "pkgs": ["bind9", "bind9-utils"],
        "check": lambda: _have("bind9"),
        "post": lambda: _enable("named") + _ufw_allow("53") + _bind_defaults(),
    },
    "certbot": {
        "name": "Certbot (Let's Encrypt)", "icon": "lock", "size": "about 10 MB",
        "desc": "Free HTTPS certificates for your domains, renewed automatically.",
        "pkgs": ["certbot", "python3-certbot-apache"],
        "needs": ["web"],
        "check": lambda: _have("certbot"),
        "post": _post_certbot,
    },
    "git": {
        "name": "Git", "icon": "git", "size": "about 10 MB",
        "desc": "Clone, pull and deploy repositories into your sites.",
        "pkgs": ["git"],
        "check": lambda: shutil.which("git", path=PATH) is not None,
    },
    "cron": {
        "name": "Cron", "icon": "cron", "size": "under 1 MB",
        "desc": "Runs scheduled jobs (backups, scripts, app tasks) at the times you choose.",
        "pkgs": ["cron"],
        "check": lambda: shutil.which("crontab", path=PATH) is not None,
        "post": lambda: _enable("cron"),
    },
    "clamav": {
        "name": "ClamAV antivirus", "icon": "virus", "size": "about 60 MB plus its virus database",
        "desc": "Scans your files and uploads for malware.",
        "pkgs": ["clamav"],
        "check": lambda: shutil.which("clamscan", path=PATH) is not None,
    },
    "modsecurity": {
        "name": "ModSecurity", "icon": "shield", "size": "about 5 MB",
        "desc": "A web application firewall for Apache that blocks common attacks.",
        "pkgs": ["libapache2-mod-security2"],
        "needs": ["web"],
        "check": lambda: Path("/etc/apache2/mods-available/security2.load").exists(),
    },
    "ddclient": {
        "name": "ddclient", "icon": "refresh", "size": "about 1 MB",
        "desc": "Keeps a dynamic DNS name pointed at this server's changing IP.",
        "pkgs": ["ddclient"],
        "check": lambda: _have("ddclient"),
    },
    "ufw": {
        "name": "Firewall (ufw)", "icon": "firewall", "size": "about 1 MB",
        "desc": "A simple firewall: choose which ports the outside world may reach. Installing it doesn't turn it on.",
        "pkgs": ["ufw"],
        "check": lambda: shutil.which("ufw", path=PATH) is not None,
    },
    "fail2ban": {
        "name": "Fail2ban", "icon": "trap", "size": "about 2 MB",
        "desc": "Bans addresses that keep guessing passwords for SSH, this panel, FTP and web logins.",
        "pkgs": ["fail2ban", "nftables"],
        "check": lambda: _have("fail2ban"),
        "post": lambda: _enable("fail2ban"),
    },
    "mail": {
        "name": "Mail server", "icon": "mail", "size": "about 60 MB",
        "desc": "Postfix (sending & receiving), Dovecot (IMAP/POP3, quotas, filters) and Rspamd (spam filtering, DKIM signing).",
        "pkgs": ["postfix", "postfix-pcre", "dovecot-core", "dovecot-imapd", "dovecot-pop3d", "dovecot-lmtpd",
                 "dovecot-sieve", "dovecot-managesieved", "rspamd", "redis-server", "openssl"],
        "check": lambda: _mail().installed() and _mail().configured(),
        "precheck": lambda: _mail().dovecot_ok(),
        "pre": lambda: _preseed("postfix postfix/main_mailer_type select Internet Site",
                                f"postfix postfix/mailname string {socket.getfqdn() or socket.gethostname()}"),
        "post": lambda: _collect(_mail().setup),
    },
    "webmail": {
        "name": "Webmail (Roundcube)", "icon": "mail", "size": "about 25 MB",
        "desc": "Read and send mail in the browser at /webmail — the modern Elastic look, works on phones.",
        "pkgs": ["roundcube", "roundcube-sqlite3", "roundcube-plugins"],
        "needs": ["web", "mail"],
        "check": lambda: _mail().webmail_installed(),
        "pre": lambda: _preseed("roundcube-core roundcube/dbconfig-install boolean true",
                                "roundcube-core roundcube/database-type select sqlite3",
                                "roundcube-core roundcube/reconfigure-webserver multiselect",
                                "roundcube-core roundcube/restart-webserver boolean false"),
        "post": lambda: _mail().setup_webmail(),
    },
    "dav": {
        "name": "Calendars & Contacts (Radicale)", "icon": "calendar", "size": "about 5 MB",
        "desc": "CalDAV / CardDAV for every mailbox: sync calendars and contacts with iPhone, Android, Thunderbird and Outlook.",
        "pkgs": ["radicale", "python3-passlib", "python3-bcrypt"],
        "needs": ["web", "mail"],
        "check": lambda: _mail().dav_installed(),
        "post": lambda: _mail().setup_dav(),
    },
    "composer": {
        "name": "Composer", "icon": "packages", "size": "about 2 MB",
        "desc": "PHP's package manager, used by Laravel, Symfony and other frameworks.",
        "pkgs": ["composer"],
        "needs": ["web"],
        "check": lambda: shutil.which("composer", path=PATH) is not None,
    },
}


def _get(cid: str) -> dict:
    if cid not in COMPONENTS:
        raise RequiresError("Unknown component")
    return COMPONENTS[cid]


def installed(cid: str) -> bool:
    try:
        return bool(_get(cid)["check"]())
    except (OSError, subprocess.SubprocessError):
        return False


def status(ids: list[str]) -> dict:
    out = {}
    for cid in ids:
        if cid not in COMPONENTS:
            continue
        c = COMPONENTS[cid]
        running = jobs.find(requires=cid)
        job = running[0] if running and running[0].status == "running" else None
        out[cid] = {"id": cid, "name": c["name"], "icon": c["icon"], "desc": c["desc"], "size": c["size"],
                    "installed": installed(cid), "job": job.id if job else None,
                    "needs": [n for n in c.get("needs", []) if not installed(n)]}
    return {"supported": shutil.which("apt-get", path=PATH) is not None, "components": out}


def install(cid: str) -> jobs.Job:
    c = _get(cid)
    if not shutil.which("apt-get", path=PATH):
        raise RequiresError("This system has no apt-get — install the software with your package manager")
    for j in jobs.find(requires=cid):
        if j.status == "running":
            return j  # already installing (another tab, or a double click)
    # Missing prerequisites go into the same job, in order.
    plan = [n for n in c.get("needs", []) if not installed(n)] + [cid]
    for n in plan:
        chk = COMPONENTS[n].get("precheck")
        if chk:
            ok, why = chk()
            if not ok:
                raise RequiresError(why)

    def fn(log):
        pkgs = [p for n in plan for p in COMPONENTS[n]["pkgs"]]
        names = " + ".join(COMPONENTS[n]["name"] for n in plan)
        log(f"• Installing {names}: {' '.join(pkgs)}")
        for n in plan:
            pre = COMPONENTS[n].get("pre")
            if pre:
                for line in pre():
                    log(line)
        log.progress(1, "Updating the package lists")
        log.apt(["update"], (1, 8))
        log.progress(8, "Downloading packages")
        rc = log.apt(["install", "--no-install-recommends", *pkgs], (8, 92))
        if rc != 0:
            # A half-finished earlier install blocks apt: finish it and retry once.
            log("• apt failed — repairing any interrupted install and retrying")
            _run(["dpkg", "--force-confold", "--configure", "-a"], 900)
            rc = log.apt(["install", "--no-install-recommends", "-f", *pkgs], (8, 92))
            if rc != 0:
                raise RequiresError(f"apt-get install failed (exit {rc}) — see the log")
        log.progress(93, "Configuring")
        for n in plan:
            post = COMPONENTS[n].get("post")
            if post:
                for line in post():
                    log(line)
        sysapps._web_cache = (0.0, None)
        missing = [COMPONENTS[n]["name"] for n in plan if not installed(n)]
        if missing:
            raise RequiresError(f"Installed, but {', '.join(missing)} still isn't detected — see the log")
        log.progress(100, f"{names} installed")
        log(f"✓ {names} installed")
        return {"installed": plan}

    return jobs.launch_fn(f"install {c['name']}", fn, meta={"requires": cid})
