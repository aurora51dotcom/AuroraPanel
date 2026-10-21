"""Simple backup / restore: tar.gz archives of chosen directories.

Archives live under BACKUP_DIR. Create/restore run as background jobs since
they can take a while. Restore extracts back to the archive's stored base path.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path

from . import jobs

BACKUP_DIR = Path(os.environ.get("AURORA_BACKUP_DIR", str(Path.home() / "aurora-backups"))).resolve()
_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class BackupError(RuntimeError):
    pass


def _ensure_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def list_backups() -> dict:
    _ensure_dir()
    items = []
    for f in sorted(BACKUP_DIR.glob("*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = f.stat()
        items.append({"name": f.name, "size": st.st_size, "modified": st.st_mtime})
    return {"dir": str(BACKUP_DIR), "backups": items}


def create_backup(source: str, label: str = "") -> jobs.Job:
    src = Path(source or "").expanduser()
    if not src.is_absolute():
        raise BackupError("Source path must be absolute")
    src = src.resolve()
    if not src.exists():
        raise BackupError("Source path does not exist")
    if label and not _NAME_RE.match(label):
        raise BackupError("Label may only contain letters, digits, dot, dash, underscore")
    _ensure_dir()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    safe_label = label or src.name or "root"
    archive = BACKUP_DIR / f"{safe_label}-{stamp}.tar.gz"
    # tar -C parent, archive basename -> restore recreates under the same parent.
    parent = str(src.parent)
    base = src.name
    argv = ["tar", "-czf", str(archive), "-C", parent, base]
    return jobs.launch(f"backup {src}", argv)


def _archive_path(name: str) -> Path:
    if not _NAME_RE.match(name.replace(".tar.gz", "")) or "/" in name or "\\" in name:
        raise BackupError("Invalid backup name")
    p = (BACKUP_DIR / name).resolve()
    if BACKUP_DIR not in p.parents:
        raise BackupError("Invalid backup path")
    if not p.is_file():
        raise BackupError("Backup not found")
    return p


def restore_backup(name: str, dest: str = "/") -> jobs.Job:
    archive = _archive_path(name)
    destp = Path(dest or "/").resolve()
    if not destp.is_dir():
        raise BackupError("Destination is not a directory")
    argv = ["tar", "-xzf", str(archive), "-C", str(destp)]
    return jobs.launch(f"restore {name} -> {destp}", argv)


def delete_backup(name: str) -> dict:
    archive = _archive_path(name)
    archive.unlink()
    return {"ok": True, "deleted": name}


def resolve_for_download(name: str) -> Path:
    return _archive_path(name)


# ======================================================================
#  Backup Wizard: one archive = files (stored with absolute paths) +
#  database dumps + manifest.json, so a restore can pick what to bring back.
# ======================================================================
import json
import shutil
import subprocess
import tempfile

_DB = re.compile(r"^[A-Za-z0-9_$-]{1,64}$")
_SYSTEM_DBS = {"information_schema", "performance_schema", "mysql", "sys", "postgres", "template0", "template1"}


def _mysql_dbs() -> list[str]:
    if not shutil.which("mysql"):
        return []
    r = subprocess.run(["mysql", "-N", "-B", "-e", "SHOW DATABASES"], capture_output=True, text=True, timeout=30)
    return [d for d in r.stdout.split() if d not in _SYSTEM_DBS] if r.returncode == 0 else []


def _pg_ready() -> bool:
    from . import databases
    return databases.pg_available()


def _pg_check():
    from . import databases
    try:
        databases.pg_require()
    except databases.DatabaseError as exc:
        raise BackupError(str(exc))


def _my_check():
    from . import databases
    try:
        databases.mysql_require()
    except databases.DatabaseError as exc:
        raise BackupError(str(exc))


def _pg_dbs() -> list[str]:
    if not _pg_ready():
        return []
    r = subprocess.run(["runuser", "-u", "postgres", "--", "psql", "-At", "-c",
                        "SELECT datname FROM pg_database WHERE NOT datistemplate"], capture_output=True, text=True, timeout=30)
    return [d for d in r.stdout.split() if d not in _SYSTEM_DBS] if r.returncode == 0 else []


def wizard_options() -> dict:
    from . import files, sysapps
    home = str(files._default_user_home())
    web = sysapps.web_root()
    return {"home": home, "web_root": web, "mysql": _mysql_dbs(), "pgsql": _pg_dbs(), "dir": str(BACKUP_DIR),
            "configs": [p for p in ("/etc/apache2", "/etc/nginx", "/etc/php", "/etc/mysql", "/etc/openvpn", "/etc/wireguard",
                                    "/etc/swanctl", "/etc/vsftpd.conf", "/etc/fail2ban", "/var/lib/aurora") if Path(p).exists()]}


def wizard_create(kind: str, paths: list[str] | None = None, mysql: list[str] | None = None, pgsql: list[str] | None = None,
                  label: str = "") -> jobs.Job:
    """kind: full | files | databases | custom."""
    opts = wizard_options()
    if kind == "full":
        paths = [p for p in (opts["home"], opts["web_root"]) if p] + opts["configs"]
        mysql, pgsql = opts["mysql"], opts["pgsql"]
    paths = [str(Path(p).resolve()) for p in (paths or []) if p]
    for p in paths:
        if not Path(p).is_absolute() or not Path(p).exists():
            raise BackupError(f"Not found: {p}")
        if p == "/" or p.startswith(("/proc", "/sys", "/dev", "/run")):
            raise BackupError(f"Can't back up {p}")
    mysql = [d for d in (mysql or []) if _DB.match(d)]
    pgsql = [d for d in (pgsql or []) if _DB.match(d)]
    if not paths and not mysql and not pgsql:
        raise BackupError("Pick at least one folder or database")
    if mysql:
        _my_check()
    if pgsql:
        _pg_check()
    if label and not _NAME_RE.match(label):
        raise BackupError("Label may only contain letters, digits, dot, dash, underscore")
    _ensure_dir()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    archive = BACKUP_DIR / f"{label or 'aurora-' + kind}-{stamp}.tar.gz"
    # Never back the backups folder up into itself.
    excludes = [f"--exclude={str(BACKUP_DIR).lstrip('/')}"]

    def fn(log):
        work = Path(tempfile.mkdtemp(prefix=".wiz-", dir=BACKUP_DIR))
        try:
            dbdir = work / "databases"
            for db in mysql:
                (dbdir / "mysql").mkdir(parents=True, exist_ok=True)
                log(f"• Dumping MariaDB database {db}…")
                with open(dbdir / "mysql" / f"{db}.sql", "wb") as fh:
                    r = subprocess.run(["mysqldump", "--single-transaction", "--routines", "--events", "--triggers", db],
                                       stdout=fh, stderr=subprocess.PIPE, timeout=3600)
                if r.returncode != 0:
                    raise BackupError(f"mysqldump {db}: {r.stderr.decode(errors='replace').strip()[-300:]}")
            for db in pgsql:
                (dbdir / "pgsql").mkdir(parents=True, exist_ok=True)
                log(f"• Dumping PostgreSQL database {db}…")
                with open(dbdir / "pgsql" / f"{db}.sql", "wb") as fh:
                    r = subprocess.run(["runuser", "-u", "postgres", "--", "pg_dump", "--no-owner", db],
                                       stdout=fh, stderr=subprocess.PIPE, timeout=3600)
                if r.returncode != 0:
                    raise BackupError(f"pg_dump {db}: {r.stderr.decode(errors='replace').strip()[-300:]}")
            manifest = {"created": int(time.time()), "kind": kind, "paths": paths, "mysql": mysql, "pgsql": pgsql,
                        "host": __import__("socket").gethostname(), "format": 1}
            (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
            log(f"• Packing {len(paths)} folder(s)/file(s)…")
            argv = ["tar", "-czf", str(archive), *excludes, "--warning=no-file-changed", "-C", str(work), "manifest.json"]
            if mysql or pgsql:
                argv.append("databases")
            if paths:
                argv += ["-C", "/", *[p.lstrip("/") for p in paths]]
            r = subprocess.run(argv, capture_output=True, text=True, timeout=7200)
            if r.returncode not in (0, 1):  # 1 = some files changed while reading
                raise BackupError("tar: " + r.stderr.strip()[-400:])
            log(f"✔ {archive.name} ({archive.stat().st_size // 1024} KB)")
            return {"name": archive.name}
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return jobs.launch_fn(f"Backup wizard: {kind}", fn)


def manifest(name: str) -> dict:
    archive = _archive_path(name)
    r = subprocess.run(["tar", "-xzOf", str(archive), "manifest.json"], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        # A plain (non-wizard) backup: list its top folder.
        t = subprocess.run(["tar", "-tzf", str(archive)], capture_output=True, text=True, timeout=120)
        top = sorted({l.split("/")[0] for l in t.stdout.splitlines() if l})[:20]
        return {"wizard": False, "top": top}
    try:
        return {"wizard": True, **json.loads(r.stdout)}
    except ValueError:
        return {"wizard": False, "top": []}


def wizard_restore(name: str, paths: list[str] | None = None, mysql: list[str] | None = None,
                   pgsql: list[str] | None = None) -> jobs.Job:
    archive = _archive_path(name)
    man = manifest(name)
    if not man.get("wizard"):
        raise BackupError("That archive wasn't made by the Backup Wizard — use Restore on the Backups page")
    paths = [p for p in (paths or []) if p in man["paths"]]
    mysql = [d for d in (mysql or []) if d in man["mysql"]]
    pgsql = [d for d in (pgsql or []) if d in man["pgsql"]]
    if not paths and not mysql and not pgsql:
        raise BackupError("Pick what to restore")
    if mysql:
        _my_check()
    if pgsql:
        _pg_check()

    def fn(log):
        if paths:
            log(f"• Restoring {len(paths)} folder(s) to their original location (existing files are overwritten)…")
            r = subprocess.run(["tar", "-xzf", str(archive), "-C", "/", *[p.lstrip("/") for p in paths]],
                               capture_output=True, text=True, timeout=7200)
            if r.returncode != 0:
                raise BackupError("tar: " + r.stderr.strip()[-400:])
        work = Path(tempfile.mkdtemp(prefix=".rst-", dir=BACKUP_DIR))
        try:
            members = [f"databases/mysql/{d}.sql" for d in mysql] + [f"databases/pgsql/{d}.sql" for d in pgsql]
            if members:
                r = subprocess.run(["tar", "-xzf", str(archive), "-C", str(work), *members], capture_output=True, text=True, timeout=3600)
                if r.returncode != 0:
                    raise BackupError("tar: " + r.stderr.strip()[-400:])
            for d in mysql:
                log(f"• Restoring MariaDB database {d}…")
                subprocess.run(["mysql", "-e", f"CREATE DATABASE IF NOT EXISTS `{d}`"], capture_output=True, timeout=60)
                with open(work / "databases" / "mysql" / f"{d}.sql", "rb") as fh:
                    r = subprocess.run(["mysql", d], stdin=fh, capture_output=True, timeout=7200)
                if r.returncode != 0:
                    raise BackupError(f"mysql {d}: {r.stderr.decode(errors='replace').strip()[-300:]}")
            for d in pgsql:
                log(f"• Restoring PostgreSQL database {d}…")
                subprocess.run(["runuser", "-u", "postgres", "--", "createdb", d], capture_output=True, timeout=60)
                src = work / "databases" / "pgsql" / f"{d}.sql"
                src.chmod(0o644)
                work.chmod(0o755)
                (work / "databases").chmod(0o755)
                (work / "databases" / "pgsql").chmod(0o755)
                r = subprocess.run(["runuser", "-u", "postgres", "--", "psql", "-q", "-v", "ON_ERROR_STOP=0", "-d", d, "-f", str(src)],
                                   capture_output=True, text=True, timeout=7200)
                if r.returncode != 0:
                    raise BackupError(f"psql {d}: {r.stderr.strip()[-300:]}")
            log("✔ Restore finished")
            return {"ok": True}
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return jobs.launch_fn(f"Restore: {name}", fn)
