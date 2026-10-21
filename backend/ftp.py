"""FTP (vsftpd): server settings + FTP accounts.

Adopts the existing vsftpd.conf layout: whatever userlist_file /
user_config_dir it already uses (defaults are added only when missing).

An FTP account = a system user with no shell whose home is the folder they
may use, listed in the userlist (with userlist_deny=NO only listed users may
log in), plus a per-user vsftpd config that sets their folder + access level:
  full      browse, download, upload, delete, rename, create folders
  readonly  browse + download only
  upload    drop box: upload only (no download, delete or rename)
Folder permissions are granted with POSIX ACLs (setfacl), so the folder's
existing owner/permissions stay untouched.

Accounts the panel created carry the GECOS tag "AuroraPanel FTP"; deleting
any other account only removes its FTP access, never the system user."""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
import time
from pathlib import Path

IS_LINUX = platform.system() == "Linux"
CONF = Path("/etc/vsftpd.conf")
TAG = "AuroraPanel FTP"
NOLOGIN = "/usr/sbin/nologin"
_USER = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_FORBIDDEN_ROOTS = ("/", "/etc", "/proc", "/sys", "/dev", "/boot", "/run", "/root", "/bin", "/sbin", "/usr", "/lib", "/var/lib")
ACCESS = {
    "full": {"label": "Full access", "conf": {"write_enable": "YES", "download_enable": "YES", "dirlist_enable": "YES", "cmds_denied": "SITE"}},
    "readonly": {"label": "Read only", "conf": {"write_enable": "NO", "download_enable": "YES", "dirlist_enable": "YES",
                                               "cmds_denied": "DELE,RMD,RNFR,RNTO,MKD,STOR,STOU,APPE,SITE"}},
    "upload": {"label": "Upload only (drop box)", "conf": {"write_enable": "YES", "download_enable": "NO", "dirlist_enable": "YES",
                                                         "cmds_denied": "DELE,RMD,RNFR,RNTO,RETR,MKD,SITE"}},
}

SCHEMA = [
    {"title": "Server", "fields": [
        {"key": "listen_port", "label": "Port", "type": "port", "help": "Standard is 21. Forward it (and the passive range) on your router for outside access."},
        {"key": "max_clients", "label": "Max simultaneous clients", "type": "int", "min": 0, "max": 10000, "help": "0 = unlimited."},
        {"key": "max_per_ip", "label": "Max connections per IP", "type": "int", "min": 0, "max": 1000, "help": "0 = unlimited."},
        {"key": "idle_session_timeout", "label": "Idle timeout (s)", "type": "int", "min": 30, "max": 86400},
        {"key": "data_connection_timeout", "label": "Transfer stall timeout (s)", "type": "int", "min": 30, "max": 86400},
        {"key": "ftpd_banner", "label": "Welcome message", "type": "text", "help": "Shown to clients when they connect."},
    ]},
    {"title": "Access (defaults for everyone)", "desc": "Each FTP account's own access level (below / FTP Accounts) overrides the upload/download defaults.", "fields": [
        {"key": "anonymous_enable", "label": "Allow anonymous login", "type": "bool", "help": "Anyone can log in without a password — leave off."},
        {"key": "local_enable", "label": "Allow account logins", "type": "bool"},
        {"key": "write_enable", "label": "Allow uploads by default", "type": "bool"},
        {"key": "download_enable", "label": "Allow downloads by default", "type": "bool"},
        {"key": "chroot_local_user", "label": "Lock users into their folder", "type": "bool", "help": "Users can't browse outside their own folder (recommended)."},
        {"key": "allow_writeable_chroot", "label": "Allow writable locked folder", "type": "bool", "help": "Needed when a user's own folder is writable."},
        {"key": "local_umask", "label": "New file permissions", "type": "select", "options": [["022", "022 — rw-r--r-- (default)"], ["002", "002 — group-writable"], ["077", "077 — private"]]},
        {"key": "userlist_enable", "label": "Only FTP accounts may log in", "type": "bool", "help": "Other Linux users on this Pi are refused (recommended)."},
    ]},
    {"title": "Passive mode (behind a router)", "desc": "FTP opens a second connection for each transfer. For access from the internet forward the port above AND this range to the Pi.", "fields": [
        {"key": "pasv_enable", "label": "Enable passive mode", "type": "bool"},
        {"key": "pasv_min_port", "label": "Passive range start", "type": "port"},
        {"key": "pasv_max_port", "label": "Passive range end", "type": "port"},
        {"key": "pasv_address", "label": "Public address for passive mode", "type": "text", "placeholder": "your public IP or DDNS name",
         "help": "Leave empty on a LAN. From the internet, set your public IP / Dynamic DNS hostname."},
    ]},
    {"title": "Security & logging", "fields": [
        {"key": "ssl_enable", "label": "Allow FTPS (TLS encryption)", "type": "bool", "help": "Encrypts logins and files. Uses the Pi's self-signed certificate."},
        {"key": "force_local_logins_ssl", "label": "Require encryption for logins", "type": "bool", "help": "Plain FTP sends passwords readable on the wire."},
        {"key": "force_local_data_ssl", "label": "Require encryption for transfers", "type": "bool"},
        {"key": "xferlog_enable", "label": "Log transfers", "type": "bool"},
    ]},
]
_KEYS = {f["key"]: f for sec in SCHEMA for f in sec["fields"]}
_DEFAULTS = {"listen_port": "21", "max_clients": "0", "max_per_ip": "0", "idle_session_timeout": "300",
             "data_connection_timeout": "300", "ftpd_banner": "", "anonymous_enable": "NO", "local_enable": "YES",
             "write_enable": "NO", "download_enable": "YES", "chroot_local_user": "NO", "allow_writeable_chroot": "NO",
             "local_umask": "022", "userlist_enable": "NO", "pasv_enable": "YES", "pasv_min_port": "", "pasv_max_port": "",
             "pasv_address": "", "ssl_enable": "NO", "force_local_logins_ssl": "YES", "force_local_data_ssl": "YES",
             "xferlog_enable": "NO"}


class FTPError(RuntimeError):
    pass


def _run(argv: list[str], input: str | None = None, check: bool = True, timeout: int = 60) -> subprocess.CompletedProcess:
    try:
        r = subprocess.run(argv, input=input, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        raise FTPError(str(exc))
    if check and r.returncode != 0:
        raise FTPError((r.stderr or r.stdout or f"{argv[0]} failed").strip()[-400:])
    return r


def installed() -> bool:
    return IS_LINUX and CONF.exists() and bool(shutil.which("vsftpd") or Path("/usr/sbin/vsftpd").exists())


def _require():
    if not installed():
        raise FTPError("vsftpd is not installed (System Applications → vsftpd → Install)")


# ---- vsftpd.conf ----
def _read_conf() -> dict[str, str]:
    out = {}
    for line in CONF.read_text(errors="replace").splitlines():
        m = re.match(r"^\s*([a-z_]+)\s*=\s*(.*?)\s*$", line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(1)] = m.group(2)
    return out


def _set_conf(changes: dict[str, str | None]) -> str:
    """Rewrite vsftpd.conf in place: replace existing keys, uncomment
    commented defaults, append the rest. None removes a key. Returns old text."""
    old = CONF.read_text(errors="replace")
    lines = old.splitlines()
    active = {m.group(1) for l in lines if (m := re.match(r"^\s*([a-z_]+)\s*=", l))}
    todo = dict(changes)
    out = []
    for line in lines:
        m = re.match(r"^\s*(#\s*)?([a-z_]+)\s*=", line)
        key = m.group(2) if m else None
        if not m or key not in changes:
            out.append(line)
            continue
        commented = bool(m.group(1))
        if not commented:
            # Every active occurrence gets the new value (or is dropped for None).
            todo.pop(key, None)
            if changes[key] is not None:
                out.append(f"{key}={changes[key]}")
        elif key not in active and key in todo and todo[key] is not None:
            out.append(f"{key}={todo.pop(key)}")  # uncomment the stock example in place
        else:
            out.append(line)
    extra = [f"{k}={v}" for k, v in todo.items() if v is not None]
    if extra:
        out += ["", "# Added by AuroraPanel", *extra]
    CONF.write_text("\n".join(out) + "\n", encoding="utf-8")
    return old


def _restart_or_rollback(old_text: str | None):
    r = subprocess.run(["systemctl", "restart", "vsftpd"], capture_output=True, text=True, timeout=30)
    time.sleep(0.8)
    ok = r.returncode == 0 and subprocess.run(["systemctl", "is-active", "--quiet", "vsftpd"]).returncode == 0
    if not ok:
        tail = subprocess.run(["journalctl", "-u", "vsftpd", "-n", "8", "--no-pager", "-o", "cat"], capture_output=True, text=True).stdout
        if old_text is not None:
            CONF.write_text(old_text, encoding="utf-8")
            subprocess.run(["systemctl", "restart", "vsftpd"], capture_output=True, timeout=30)
        raise FTPError("vsftpd refused the new settings, so they were undone. " + tail.strip()[-400:])


def settings() -> dict:
    _require()
    conf = _read_conf()
    values = {k: conf.get(k, _DEFAULTS.get(k, "")) for k in _KEYS}
    return {"schema": SCHEMA, "values": values, "bool_values": ["YES", "NO"], "config_file": str(CONF),
            "active": subprocess.run(["systemctl", "is-active", "--quiet", "vsftpd"]).returncode == 0}


def save_settings(changes: dict) -> dict:
    _require()
    clean: dict[str, str | None] = {}
    for k, v in (changes or {}).items():
        f = _KEYS.get(k)
        if not f:
            raise FTPError(f"Unknown setting {k}")
        v = str(v).strip()
        if "\n" in v or "\r" in v:
            raise FTPError(f"{f['label']}: invalid characters")
        t = f["type"]
        if t == "bool":
            v = "YES" if v.upper() in ("YES", "ON", "TRUE", "1") else "NO"
        elif t in ("int", "port"):
            if v == "" and k in ("pasv_min_port", "pasv_max_port"):
                clean[k] = None
                continue
            if not re.match(r"^\d+$", v):
                raise FTPError(f"{f['label']}: must be a number")
            lo, hi = (1, 65535) if t == "port" else (f.get("min", 0), f.get("max", 1 << 30))
            if not lo <= int(v) <= hi:
                raise FTPError(f"{f['label']}: must be between {lo} and {hi}")
        elif t == "select":
            if v not in [o[0] for o in f["options"]]:
                raise FTPError(f"{f['label']}: invalid choice")
        elif k == "pasv_address":
            if v and not re.match(r"^[A-Za-z0-9.-]{1,253}$", v):
                raise FTPError("Public address: hostname or IPv4 only")
            if not v:
                clean["pasv_address"] = None
                clean["pasv_addr_resolve"] = None
                continue
            clean["pasv_addr_resolve"] = "NO" if re.match(r"^\d+(\.\d+){3}$", v) else "YES"
        clean[k] = v
    merged = {**_read_conf(), **{k: v for k, v in clean.items() if v is not None}}
    lo, hi = merged.get("pasv_min_port"), merged.get("pasv_max_port")
    if lo and hi and int(lo) > int(hi):
        raise FTPError("Passive range start must be ≤ end")
    if merged.get("ssl_enable") == "YES":
        clean.setdefault("rsa_cert_file", merged.get("rsa_cert_file") or "/etc/ssl/certs/ssl-cert-snakeoil.pem")
        clean.setdefault("rsa_private_key_file", merged.get("rsa_private_key_file") or "/etc/ssl/private/ssl-cert-snakeoil.key")
        clean.setdefault("ssl_tlsv1", "NO")  # vsftpd 3 defaults to TLS 1.2+
    if merged.get("userlist_enable") == "YES":
        _ensure_layout(clean)
    old = _set_conf(clean)
    _restart_or_rollback(old)
    return {"ok": True, **settings()}


# ---- layout for accounts ----
def _paths() -> tuple[Path, Path]:
    conf = _read_conf()
    return Path(conf.get("userlist_file") or "/etc/vsftpd.user_list"), Path(conf.get("user_config_dir") or "/etc/vsftpd/user_conf")


def _ensure_layout(pending: dict | None = None) -> bool:
    """Make sure accounts work: only-listed-users mode, per-user configs,
    users locked in their folder, and nologin accepted by PAM (pam_shells)."""
    conf = _read_conf()
    need = {}
    if conf.get("userlist_enable") != "YES":
        need["userlist_enable"] = "YES"
    if conf.get("userlist_deny") != "NO":
        need["userlist_deny"] = "NO"
    if not conf.get("userlist_file"):
        need["userlist_file"] = "/etc/vsftpd.user_list"
    if not conf.get("user_config_dir"):
        need["user_config_dir"] = "/etc/vsftpd/user_conf"
    if conf.get("chroot_local_user") != "YES":
        need["chroot_local_user"] = "YES"
    if conf.get("allow_writeable_chroot") != "YES":
        need["allow_writeable_chroot"] = "YES"
    if conf.get("local_enable") != "YES":
        need["local_enable"] = "YES"
    shells = Path("/etc/shells")
    if NOLOGIN not in shells.read_text().split():
        with shells.open("a") as f:
            f.write(f"{NOLOGIN}\n")
    if pending is not None:
        for k, v in need.items():
            pending.setdefault(k, v)
        return False
    if need:
        old = _set_conf(need)
        _restart_or_rollback(old)
    ul, ucd = _paths()
    ucd.mkdir(parents=True, exist_ok=True)
    ul.touch(exist_ok=True)
    return bool(need)


def _userlist() -> list[str]:
    ul, _ = _paths()
    try:
        return [l.strip() for l in ul.read_text().splitlines() if l.strip() and not l.startswith("#")]
    except OSError:
        return []


def _write_userlist(names: list[str]):
    ul, _ = _paths()
    keep = [l for l in (ul.read_text().splitlines() if ul.exists() else []) if l.startswith("#")]
    ul.write_text("\n".join(keep + sorted(set(names))) + "\n", encoding="utf-8")


def _user_conf(name: str) -> dict[str, str]:
    _, ucd = _paths()
    out = {}
    try:
        for line in (ucd / name).read_text().splitlines():
            m = re.match(r"^\s*([a-z_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2)
    except OSError:
        pass
    return out


def _access_of(uc: dict, global_conf: dict) -> str:
    eff = {**global_conf, **uc}
    if eff.get("download_enable", "YES") == "NO" and eff.get("write_enable") == "YES":
        return "upload"
    if eff.get("write_enable") != "YES":
        return "readonly"
    return "full" if "DELE" not in eff.get("cmds_denied", "") else "custom"


def _pw(name: str):
    import pwd
    try:
        return pwd.getpwnam(name)
    except KeyError:
        return None


def _locked(name: str) -> bool:
    r = subprocess.run(["passwd", "-S", name], capture_output=True, text=True)
    parts = r.stdout.split()
    return len(parts) > 1 and parts[1] in ("L", "LK")


def accounts() -> dict:
    _require()
    conf = _read_conf()
    listed = set(_userlist())
    _, ucd = _paths()
    names = listed | {p.name for p in ucd.glob("*") if p.is_file()} if ucd.exists() else listed
    out = []
    for n in sorted(names):
        pw = _pw(n)
        if not pw:
            continue
        uc = _user_conf(n)
        folder = uc.get("local_root") or pw.pw_dir
        out.append({"name": n, "folder": folder, "access": _access_of(uc, conf), "enabled": n in listed and not _locked(n),
                    "managed": TAG in (pw.pw_gecos or ""), "folder_exists": Path(folder).is_dir(), "uid": pw.pw_uid})
    return {"accounts": out, "access_levels": {k: v["label"] for k, v in ACCESS.items()},
            "server": {"port": conf.get("listen_port", "21"), "ssl": conf.get("ssl_enable") == "YES",
                       "passive": [conf.get("pasv_min_port"), conf.get("pasv_max_port")],
                       "only_listed": conf.get("userlist_enable") == "YES" and conf.get("userlist_deny") == "NO",
                       "active": subprocess.run(["systemctl", "is-active", "--quiet", "vsftpd"]).returncode == 0}}


def _check_folder(folder: str, create: bool) -> Path:
    p = Path((folder or "").strip())
    if not p.is_absolute() or ".." in p.parts:
        raise FTPError("Folder must be an absolute path, e.g. /var/www/html")
    rp = Path(str(p.resolve()) if p.exists() else str(p))
    if str(rp) in _FORBIDDEN_ROOTS or any(str(rp).startswith(r + "/") for r in ("/etc", "/proc", "/sys", "/dev", "/boot", "/run", "/root")):
        raise FTPError("That folder is off-limits for FTP (system area)")
    if not rp.exists():
        if not create:
            raise FTPError("Folder does not exist")
        rp.mkdir(parents=True)
    if not rp.is_dir():
        raise FTPError("Not a folder")
    return rp


def _grant(name: str, folder: Path, access: str):
    """ACL so the account can use the folder without changing its owner."""
    if not shutil.which("setfacl"):
        raise FTPError("setfacl is missing (apt install acl)")
    perm = "rX" if access == "readonly" else "rwX"
    _run(["setfacl", "-R", "-m", f"u:{name}:{perm},d:u:{name}:{perm}", str(folder)], timeout=300)
    # Let them reach the folder: execute-only on parents that others can't already pass through.
    for parent in _closed_parents(folder):
        _run(["setfacl", "-m", f"u:{name}:x", str(parent)], check=False)


def _closed_parents(folder: Path) -> list[Path]:
    return [p for p in list(folder.parents)[:-1] if p.exists() and not (p.stat().st_mode & 0o001)]


def _revoke(name: str, folder: str):
    if shutil.which("setfacl") and Path(folder).is_dir():
        _run(["setfacl", "-R", "-x", f"u:{name},d:u:{name}", folder], check=False, timeout=300)
        for parent in _closed_parents(Path(folder)):
            _run(["setfacl", "-x", f"u:{name}", str(parent)], check=False)


def _write_user_conf(name: str, folder: Path, access: str):
    _, ucd = _paths()
    ucd.mkdir(parents=True, exist_ok=True)
    cfg = {"local_root": str(folder), **ACCESS[access]["conf"]}
    (ucd / name).write_text("".join(f"{k}={v}\n" for k, v in cfg.items()), encoding="utf-8")


def _password_ok(pw: str) -> str:
    if not pw or len(pw) < 8 or len(pw) > 128 or ":" in pw or "\n" in pw:
        raise FTPError("Password: 8–128 characters, no ':' or line breaks")
    return pw


def create(name: str, password: str, folder: str, access: str = "full", create_folder: bool = True) -> dict:
    _require()
    name = (name or "").strip().lower()
    if not _USER.match(name):
        raise FTPError("Username: lowercase letters, digits, - and _ (max 32, start with a letter)")
    if _pw(name):
        raise FTPError("That name is already a user on this Pi — pick another")
    if access not in ACCESS:
        raise FTPError("Unknown access level")
    _password_ok(password)
    changed = _ensure_layout()
    path = _check_folder(folder, create_folder)
    _run(["useradd", "-M", "-d", str(path), "-s", NOLOGIN, "-c", TAG, name])
    try:
        _run(["chpasswd"], input=f"{name}:{password}\n")
        _grant(name, path, access)
        _write_user_conf(name, path, access)
        _write_userlist(_userlist() + [name])
    except FTPError:
        _run(["userdel", name], check=False)
        raise
    return {"ok": True, "name": name, "folder": str(path), "access": access, "server_reconfigured": changed}


def _get(name: str):
    pw = _pw(name)
    if not pw or (name not in _userlist() and not (_paths()[1] / name).exists()):
        raise FTPError("No such FTP account")
    return pw


def set_password(name: str, password: str) -> dict:
    _require()
    _get(name)
    _run(["chpasswd"], input=f"{name}:{_password_ok(password)}\n")
    return {"ok": True}


def modify(name: str, folder: str | None = None, access: str | None = None, create_folder: bool = True) -> dict:
    _require()
    pw = _get(name)
    uc = _user_conf(name)
    cur_folder = uc.get("local_root") or pw.pw_dir
    cur_access = _access_of(uc, _read_conf())
    new_access = access or (cur_access if cur_access in ACCESS else "full")
    if new_access not in ACCESS:
        raise FTPError("Unknown access level")
    new_folder = _check_folder(folder, create_folder) if folder else Path(cur_folder)
    if str(new_folder) != cur_folder or new_access != cur_access:
        _revoke(name, cur_folder)
        _grant(name, new_folder, new_access)
        if TAG in (pw.pw_gecos or ""):
            _run(["usermod", "-d", str(new_folder), name])
    _write_user_conf(name, new_folder, new_access)
    return {"ok": True, "folder": str(new_folder), "access": new_access}


def set_enabled(name: str, enabled: bool) -> dict:
    _require()
    _get(name)
    names = [n for n in _userlist() if n != name] + ([name] if enabled else [])
    _write_userlist(names)
    _run(["usermod", "-U" if enabled else "-L", name], check=False)
    # Drop live sessions of a disabled account.
    if not enabled:
        subprocess.run(["pkill", "-u", name, "vsftpd"], capture_output=True)
    return {"ok": True}


def delete(name: str) -> dict:
    _require()
    pw = _get(name)
    uc = _user_conf(name)
    folder = uc.get("local_root") or pw.pw_dir
    subprocess.run(["pkill", "-u", name, "vsftpd"], capture_output=True)
    _write_userlist([n for n in _userlist() if n != name])
    (_paths()[1] / name).unlink(missing_ok=True)
    removed_user = False
    if TAG in (pw.pw_gecos or ""):
        _revoke(name, folder)
        _run(["userdel", name], check=False)
        removed_user = True
    return {"ok": True, "removed_system_user": removed_user,
            "note": None if removed_user else "FTP access removed; the Linux user itself was not created by the panel and was kept."}


def logs(lines: int = 150) -> str:
    for f in ("/var/log/vsftpd.log", "/var/log/xferlog"):
        p = Path(f)
        if p.exists():
            return "\n".join(p.read_text(errors="replace").splitlines()[-lines:])
    return subprocess.run(["journalctl", "-u", "vsftpd", "-n", str(lines), "--no-pager", "-o", "short-iso"],
                          capture_output=True, text=True).stdout
