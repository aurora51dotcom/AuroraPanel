"""Databases: MariaDB/MySQL + PostgreSQL management, plus phpMyAdmin/phpPgAdmin
detection. The panel runs as root, so it reaches MariaDB via unix-socket auth
and PostgreSQL by running psql as the postgres role.
"""
from __future__ import annotations

import glob
import platform
import re
import shutil
import subprocess
from pathlib import Path

from . import jobs

IS_LINUX = platform.system() == "Linux"
_IDENT = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_HOST = re.compile(r"^[A-Za-z0-9_%.-]{1,60}$")
_MYSQL_SYS = {"mysql", "information_schema", "performance_schema", "sys"}
_PG_SYS = {"postgres", "template0", "template1"}


class DatabaseError(RuntimeError):
    pass


def _ident(name: str, what: str = "name") -> str:
    if not _IDENT.match(name or ""):
        raise DatabaseError(f"Invalid {what} (letters, digits, underscore; max 64)")
    return name


def _password(pw: str) -> str:
    if not pw or len(pw) < 6 or len(pw) > 128:
        raise DatabaseError("Password must be 6–128 characters")
    if any(c in pw for c in "'\"\\`;\n\r"):
        raise DatabaseError("Password may not contain quotes, backslash, backtick, semicolon or newlines")
    return pw


# =========================== MariaDB / MySQL ===============================
def mysql_available() -> bool:
    return bool(IS_LINUX and shutil.which("mysql"))


def _mysql(sql: str) -> str:
    if not mysql_available():
        raise DatabaseError("MariaDB/MySQL client is not installed")
    out = subprocess.run(["mysql", "-N", "-B", "-e", sql], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise DatabaseError(out.stderr.strip() or "MySQL command failed")
    return out.stdout


def mysql_databases() -> list[dict]:
    dbs = []
    for line in _mysql("SHOW DATABASES;").splitlines():
        name = line.strip()
        if name:
            dbs.append({"name": name, "system": name in _MYSQL_SYS})
    return dbs


def mysql_users() -> list[dict]:
    users = []
    for line in _mysql("SELECT User, Host FROM mysql.user;").splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            users.append({"user": parts[0], "host": parts[1]})
    return users


def mysql_create_db(name: str) -> dict:
    _ident(name, "database name")
    _mysql(f"CREATE DATABASE `{name}`;")
    return {"ok": True}


def mysql_drop_db(name: str) -> dict:
    _ident(name, "database name")
    if name in _MYSQL_SYS:
        raise DatabaseError("Refusing to drop a system database")
    _mysql(f"DROP DATABASE `{name}`;")
    return {"ok": True}


def mysql_create_user(user: str, host: str, password: str) -> dict:
    _ident(user, "username")
    if not _HOST.match(host or ""):
        raise DatabaseError("Invalid host")
    _password(password)
    _mysql(f"CREATE USER `{user}`@`{host}` IDENTIFIED BY '{password}';")
    return {"ok": True}


def mysql_wizard(db: str, user: str, password: str, host: str = "localhost") -> dict:
    """Create a database + user and grant the user full access to it."""
    _ident(db, "database name")
    _ident(user, "username")
    if not _HOST.match(host or ""):
        raise DatabaseError("Invalid host")
    _password(password)
    _mysql(f"CREATE DATABASE IF NOT EXISTS `{db}`;")
    _mysql(f"CREATE USER IF NOT EXISTS `{user}`@`{host}` IDENTIFIED BY '{password}';")
    _mysql(f"GRANT ALL PRIVILEGES ON `{db}`.* TO `{user}`@`{host}`; FLUSH PRIVILEGES;")
    return {"ok": True, "database": db, "user": f"{user}@{host}"}


# =============================== PostgreSQL =================================
PG_USER = "postgres"


def _pg_user_exists() -> bool:
    try:
        import pwd
        pwd.getpwnam(PG_USER)
        return True
    except (ImportError, KeyError):
        return False


def pg_status() -> dict:
    """Is the server installed (Debian layout: /usr/lib/postgresql/NN) and is a cluster online?"""
    installed = (IS_LINUX and bool(shutil.which("psql")) and bool(glob.glob("/usr/lib/postgresql/*/bin/postgres"))
                 and _pg_user_exists())
    running = False
    if installed and shutil.which("pg_lsclusters"):
        out = subprocess.run(["pg_lsclusters", "-h"], capture_output=True, text=True, timeout=10)
        # columns: ver cluster port status owner datadir log
        running = any(len(c) > 3 and c[3].startswith("online") for c in (l.split() for l in out.stdout.splitlines()))
    return {"installed": installed, "running": running}


def pg_repair() -> dict:
    """Give every cluster's data directory back to the postgres role (fixes 'could not
    open file "global/pg_filenode.map": Permission denied' after a stray chown), then restart."""
    if not pg_status()["installed"] or not shutil.which("pg_lsclusters"):
        raise DatabaseError("PostgreSQL is not installed")
    out = subprocess.run(["pg_lsclusters", "-h"], capture_output=True, text=True, timeout=10)
    datadirs = [c[5] for c in (l.split() for l in out.stdout.splitlines()) if len(c) > 5]
    paths = [p for p in ["/var/lib/postgresql", *datadirs] if Path(p).exists()]
    logs = [p for p in ["/var/log/postgresql"] if Path(p).exists()]
    subprocess.run(["systemctl", "stop", "postgresql"], capture_output=True, text=True, timeout=60)
    for p in paths:
        subprocess.run(["chown", "-R", "postgres:postgres", p], capture_output=True, text=True, timeout=120)
    for p in datadirs:
        subprocess.run(["chmod", "700", p], capture_output=True, text=True, timeout=10)
    for p in logs:
        subprocess.run(["chown", "-R", "postgres:adm", p], capture_output=True, text=True, timeout=60)
    r = subprocess.run(["systemctl", "start", "postgresql"], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise DatabaseError(r.stderr.strip() or "PostgreSQL failed to start after repair")
    return {"ok": True, "fixed": paths + logs, **pg_status()}


def pg_require():
    """Raise a readable error unless the PostgreSQL server is installed and running —
    instead of letting runuser fail with 'user postgres does not exist'."""
    if not IS_LINUX:
        raise DatabaseError("PostgreSQL management is only available on Linux")
    st = pg_status()
    if not st["installed"]:
        raise DatabaseError("PostgreSQL isn't installed on this Pi. Install it from System Applications → Extras "
                            "(or the Install button on the PostgreSQL Databases page).")
    if not st["running"]:
        raise DatabaseError("PostgreSQL is installed but not running. Start it from System Applications → Extras.")


def pg_available() -> bool:
    st = pg_status()
    return st["installed"] and st["running"] and _pg_runner() is not None


def _pg_runner() -> list[str] | None:
    if shutil.which("runuser"):
        return ["runuser", "-u", PG_USER, "--"]
    if shutil.which("su"):
        return ["su", "-s", "/bin/sh", PG_USER, "-c"]
    return None


def _psql(sql: str) -> str:
    pg_require()
    runner = _pg_runner()
    if not runner:
        raise DatabaseError("Cannot run psql as the postgres role")
    if runner[0] == "runuser":
        argv = runner + ["psql", "-tAc", sql]
        out = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    else:  # su -c takes a single shell string
        out = subprocess.run(runner + [f"psql -tAc \"{sql}\""], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise DatabaseError(out.stderr.strip() or "psql command failed")
    return out.stdout


def pg_databases() -> list[dict]:
    dbs = []
    for line in _psql("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;").splitlines():
        name = line.strip()
        if name:
            dbs.append({"name": name, "system": name in _PG_SYS})
    return dbs


def pg_roles() -> list[dict]:
    roles = []
    for line in _psql("SELECT rolname FROM pg_roles ORDER BY rolname;").splitlines():
        name = line.strip()
        if name:
            roles.append({"name": name, "system": name.startswith("pg_") or name == "postgres"})
    return roles


def pg_create_db(name: str) -> dict:
    _ident(name, "database name")
    _run_pg_sql(f'CREATE DATABASE "{name}";')
    return {"ok": True}


def pg_drop_db(name: str) -> dict:
    _ident(name, "database name")
    if name in _PG_SYS:
        raise DatabaseError("Refusing to drop a system database")
    _run_pg_sql(f'DROP DATABASE "{name}";')
    return {"ok": True}


def _run_pg_sql(sql_with_dquotes: str) -> str:
    """Run a statement whose identifiers are wrapped in real double quotes,
    handling the su-vs-runuser quoting difference."""
    pg_require()
    runner = _pg_runner()
    if not runner:
        raise DatabaseError("Cannot run psql as the postgres role")
    if runner[0] == "runuser":
        out = subprocess.run(runner + ["psql", "-tAc", sql_with_dquotes], capture_output=True, text=True, timeout=30)
    else:
        esc = sql_with_dquotes.replace('"', '\\"')
        out = subprocess.run(runner + [f'psql -tAc "{esc}"'], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise DatabaseError(out.stderr.strip() or "psql command failed")
    return out.stdout


# ---------------------------------------------------- PostgreSQL management
# Identifiers are restricted to [A-Za-z0-9_] by _ident() and passwords may not contain
# quotes (_password), so interpolating them into SQL below is safe.
_PG_PROTECTED = {"postgres"}


def _pg(sql: str, db: str | None = None) -> list[list[str]]:
    """Run one statement as the postgres superuser; rows as lists of columns."""
    pg_require()
    if not shutil.which("runuser"):
        raise DatabaseError("runuser is required to manage PostgreSQL")
    argv = ["runuser", "-u", PG_USER, "--", "psql", "-X", "-q", "-tA", "-F", "\t", "-v", "ON_ERROR_STOP=1"]
    if db:
        argv += ["-d", db]
    out = subprocess.run(argv + ["-c", sql], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        msg = out.stderr.strip()
        raise DatabaseError(re.sub(r"^(psql:[^:]*:\d+: )?ERROR:\s*", "", msg.splitlines()[0] if msg else "psql command failed"))
    return [line.split("\t") for line in out.stdout.splitlines() if line]


def _pg_role_name(name: str) -> str:
    _ident(name, "role name")
    if name.lower().startswith("pg_"):
        raise DatabaseError("Role names starting with pg_ are reserved by PostgreSQL")
    return name


def _pg_role_exists(name: str) -> bool:
    return bool(_pg(f"SELECT 1 FROM pg_roles WHERE rolname = '{name}'"))


def _pg_db_exists(name: str) -> bool:
    return bool(_pg(f"SELECT 1 FROM pg_database WHERE datname = '{name}'"))


def pg_overview() -> dict:
    """Databases (owner, size, encoding, who has access) and roles (attributes)."""
    dbs = []
    for r in _pg("SELECT d.datname, pg_get_userbyid(d.datdba), pg_size_pretty(pg_database_size(d.oid)), "
                 "pg_encoding_to_char(d.encoding), d.datistemplate, "
                 "(SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname), "
                 "coalesce((SELECT string_agg(DISTINCT g.rolname, ',') FROM aclexplode(d.datacl) x "
                 "  JOIN pg_roles g ON g.oid = x.grantee WHERE x.privilege_type = 'CREATE' AND g.oid <> d.datdba), '') "
                 "FROM pg_database d ORDER BY d.datistemplate, d.datname"):
        if len(r) < 7 or r[4] == "t":
            continue  # templates aren't user databases
        dbs.append({"name": r[0], "owner": r[1], "size": r[2], "encoding": r[3], "connections": int(r[5] or 0),
                    "access": [a for a in r[6].split(",") if a], "system": r[0] in _PG_SYS})
    roles = []
    for r in _pg("SELECT a.rolname, a.rolcanlogin, a.rolsuper, a.rolcreatedb, a.rolcreaterole, a.rolpassword IS NOT NULL, "
                 "a.rolconnlimit, coalesce((SELECT string_agg(d.datname, ',') FROM pg_database d WHERE d.datdba = a.oid "
                 "  AND NOT d.datistemplate), '') "
                 "FROM pg_authid a WHERE a.rolname NOT LIKE 'pg\\_%' ORDER BY a.rolname"):
        if len(r) < 8:
            continue
        roles.append({"name": r[0], "login": r[1] == "t", "superuser": r[2] == "t", "createdb": r[3] == "t",
                      "createrole": r[4] == "t", "has_password": r[5] == "t", "conn_limit": int(r[6]),
                      "owns": [d for d in r[7].split(",") if d], "system": r[0] in _PG_PROTECTED})
    return {"databases": dbs, "roles": roles}


def pg_create_db_owned(name: str, owner: str = "") -> dict:
    _ident(name, "database name")
    if _pg_db_exists(name):
        raise DatabaseError(f"Database {name} already exists")
    if owner:
        _ident(owner, "owner")
        if not _pg_role_exists(owner):
            raise DatabaseError(f"No role named {owner}")
    _pg(f'CREATE DATABASE "{name}"' + (f' OWNER "{owner}"' if owner else "") + " ENCODING 'UTF8' TEMPLATE template0")
    return {"ok": True}


def pg_drop_db_force(name: str) -> dict:
    _ident(name, "database name")
    if name in _PG_SYS:
        raise DatabaseError("Refusing to drop a system database")
    # WITH (FORCE) disconnects open sessions instead of failing (PostgreSQL 13+).
    _pg(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    return {"ok": True}


def pg_set_owner(db: str, role: str) -> dict:
    _ident(db, "database name")
    _ident(role, "role name")
    if db in _PG_SYS:
        raise DatabaseError("System databases stay owned by postgres")
    if not _pg_role_exists(role):
        raise DatabaseError(f"No role named {role}")
    _pg(f'ALTER DATABASE "{db}" OWNER TO "{role}"')
    # PostgreSQL 15+: the public schema belongs to pg_database_owner, so the new owner can
    # create tables; tables that already exist (e.g. made by postgres) still need a grant.
    if role not in _PG_PROTECTED:
        pg_grant(db, role, True)
    return {"ok": True}


def pg_grant(db: str, role: str, grant: bool = True) -> dict:
    """Full read/write access to a database for a role (or take it away)."""
    _ident(db, "database name")
    _pg_role_name(role)
    if db in _PG_SYS:
        raise DatabaseError("Grant access to your own databases, not the system ones")
    if not _pg_role_exists(role):
        raise DatabaseError(f"No role named {role}")
    # Default privileges apply to objects created by a given role, so cover the database
    # owner (who normally creates the tables) and postgres — not just whoever runs this.
    owner = (_pg(f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{db}'") or [[""]])[0][0]
    if not owner:
        raise DatabaseError(f"No database named {db}")
    creators = sorted({owner, "postgres"} - {role})
    if grant:
        _pg(f'GRANT ALL PRIVILEGES ON DATABASE "{db}" TO "{role}"')
        stmts = [f'GRANT ALL ON SCHEMA public TO "{role}"',
                 f'GRANT ALL ON ALL TABLES IN SCHEMA public TO "{role}"',
                 f'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{role}"',
                 f'GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO "{role}"']
        for c in creators:  # tables/sequences created later are covered too
            stmts += [f'ALTER DEFAULT PRIVILEGES FOR ROLE "{c}" IN SCHEMA public GRANT ALL ON TABLES TO "{role}"',
                      f'ALTER DEFAULT PRIVILEGES FOR ROLE "{c}" IN SCHEMA public GRANT ALL ON SEQUENCES TO "{role}"']
        for stmt in stmts:
            _pg(stmt, db)
    else:
        for c in creators:
            _pg(f'ALTER DEFAULT PRIVILEGES FOR ROLE "{c}" IN SCHEMA public REVOKE ALL ON TABLES FROM "{role}"', db)
            _pg(f'ALTER DEFAULT PRIVILEGES FOR ROLE "{c}" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "{role}"', db)
        for stmt in (f'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM "{role}"',
                     f'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "{role}"',
                     f'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{role}"',
                     f'REVOKE ALL ON SCHEMA public FROM "{role}"'):
            _pg(stmt, db)
        _pg(f'REVOKE ALL PRIVILEGES ON DATABASE "{db}" FROM "{role}"')
    return {"ok": True}


def pg_create_role(name: str, password: str, login: bool = True, createdb: bool = False,
                   createrole: bool = False, superuser: bool = False) -> dict:
    _pg_role_name(name)
    if _pg_role_exists(name):
        raise DatabaseError(f"Role {name} already exists")
    opts = ["LOGIN" if login else "NOLOGIN", "CREATEDB" if createdb else "NOCREATEDB",
            "CREATEROLE" if createrole else "NOCREATEROLE", "SUPERUSER" if superuser else "NOSUPERUSER"]
    if login:
        _password(password)
        opts.append(f"PASSWORD '{password}'")
    _pg(f'CREATE ROLE "{name}" ' + " ".join(opts))
    return {"ok": True, "role": name}


def pg_update_role(name: str, login: bool, createdb: bool, createrole: bool, superuser: bool,
                   conn_limit: int = -1) -> dict:
    _pg_role_name(name)
    if name in _PG_PROTECTED:
        raise DatabaseError("The postgres role can't be changed here")
    if not _pg_role_exists(name):
        raise DatabaseError(f"No role named {name}")
    if not -1 <= int(conn_limit) <= 10000:
        raise DatabaseError("Connection limit: -1 (unlimited) to 10000")
    opts = ["LOGIN" if login else "NOLOGIN", "CREATEDB" if createdb else "NOCREATEDB",
            "CREATEROLE" if createrole else "NOCREATEROLE", "SUPERUSER" if superuser else "NOSUPERUSER",
            f"CONNECTION LIMIT {int(conn_limit)}"]
    _pg(f'ALTER ROLE "{name}" ' + " ".join(opts))
    return {"ok": True}


def pg_set_password(name: str, password: str) -> dict:
    _ident(name, "role name")
    _password(password)
    if not _pg_role_exists(name):
        raise DatabaseError(f"No role named {name}")
    _pg(f"ALTER ROLE \"{name}\" PASSWORD '{password}'")
    return {"ok": True}


def pg_drop_role(name: str) -> dict:
    """Drop a role; whatever it owns (databases, tables) is handed to postgres first."""
    _pg_role_name(name)
    if name in _PG_PROTECTED:
        raise DatabaseError("The postgres role can't be removed")
    if not _pg_role_exists(name):
        raise DatabaseError(f"No role named {name}")
    for (db,) in _pg(f"SELECT datname FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = '{name}')"):
        _pg(f'ALTER DATABASE "{db}" OWNER TO postgres')
    # Objects and grants live per database: clean them up in every one we can connect to.
    for (db,) in _pg("SELECT datname FROM pg_database WHERE datallowconn"):
        _pg(f'REASSIGN OWNED BY "{name}" TO postgres', db)
        _pg(f'DROP OWNED BY "{name}"', db)
    _pg(f'DROP ROLE "{name}"')
    return {"ok": True}


# ------------------------------------------------------------- phpPgAdmin
# Debian's phppgadmin.conf says "Require local", so it only works from the Pi itself.
# This override (loaded after it) also lets in private networks: your LAN and VPN clients.
PGA_ACCESS_CONF = Path("/etc/apache2/conf-available/zz-aurora-phppgadmin.conf")
_PGA_ACCESS = """# Managed by AuroraPanel — lets phpPgAdmin be used from your local network / VPN
# (Debian's phppgadmin.conf only allows the Pi itself). Delete via the panel to undo.
<Directory /usr/share/phppgadmin>
    Require local
    Require ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7 fe80::/10
</Directory>
"""


def phppgadmin_status() -> dict:
    installed = phppgadmin_installed()
    enabled = Path("/etc/apache2/conf-enabled/phppgadmin.conf").exists()
    lan = (Path("/etc/apache2/conf-enabled") / PGA_ACCESS_CONF.name).exists()
    if installed and not lan:
        txt = ""
        try:
            txt = Path("/etc/apache2/conf-available/phppgadmin.conf").read_text(errors="replace")
        except OSError:
            pass
        lan = "Require local" not in txt  # someone opened it up by hand
    return {"installed": installed, "enabled": enabled, "lan": lan, "path": "/phppgadmin",
            "apache": subprocess.run(["systemctl", "is-active", "--quiet", "apache2"]).returncode == 0 if IS_LINUX else False}


def phppgadmin_set_lan(on: bool) -> dict:
    from .webaccess import _reload_apache
    if not IS_LINUX or not shutil.which("a2enconf"):
        raise DatabaseError("Apache is not installed")
    if on:
        PGA_ACCESS_CONF.write_text(_PGA_ACCESS)
        subprocess.run(["a2enconf", "-q", PGA_ACCESS_CONF.stem], capture_output=True, timeout=30)
    else:
        subprocess.run(["a2disconf", "-q", PGA_ACCESS_CONF.stem], capture_output=True, timeout=30)
        PGA_ACCESS_CONF.unlink(missing_ok=True)
    t = subprocess.run(["apache2ctl", "configtest"], capture_output=True, text=True, timeout=30)
    if t.returncode != 0:
        subprocess.run(["a2disconf", "-q", PGA_ACCESS_CONF.stem], capture_output=True, timeout=30)
        PGA_ACCESS_CONF.unlink(missing_ok=True)
        raise DatabaseError("Apache rejected the change, nothing was applied:\n" + t.stderr.strip()[-400:])
    _reload_apache()
    return {"ok": True, **phppgadmin_status()}


def phppgadmin_install() -> jobs.Job:
    """apt install phppgadmin, then open it to the local network."""
    def fn(log):
        env = {"DEBIAN_FRONTEND": "noninteractive", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}
        log("• Installing phpPgAdmin (apt-get install phppgadmin php-pgsql)…")
        r = subprocess.run(["apt-get", "-o", "DPkg::Lock::Timeout=600", "-y", "install", "phppgadmin", "php-pgsql"],
                           capture_output=True, text=True, env=env, timeout=1800)
        log(r.stdout[-3000:] + r.stderr[-1500:])
        if r.returncode != 0:
            raise DatabaseError("apt-get install failed")
        log("• Allowing access from your local network…")
        phppgadmin_set_lan(True)
        log("✔ phpPgAdmin is ready at /phppgadmin — log in with a PostgreSQL role that has a password.")
        return {"ok": True}
    return jobs.launch_fn("Install phpPgAdmin", fn)


def pg_wizard(db: str, role: str, password: str) -> dict:
    _ident(db, "database name")
    _ident(role, "role name")
    _password(password)
    _run_pg_sql(f"CREATE ROLE \"{role}\" LOGIN PASSWORD '{password}';")
    _run_pg_sql(f"CREATE DATABASE \"{db}\" OWNER \"{role}\";")
    return {"ok": True, "database": db, "role": role}


# ============================= web admin tools =============================
def phpmyadmin_installed() -> bool:
    return any(Path(p).exists() for p in ("/usr/share/phpmyadmin", "/etc/phpmyadmin"))


def phppgadmin_installed() -> bool:
    return any(Path(p).exists() for p in ("/usr/share/phppgadmin", "/etc/phppgadmin"))


def overview() -> dict:
    return {
        "mysql": {"available": mysql_available()},
        "postgres": {"available": pg_available()},
        "phpmyadmin": {"installed": phpmyadmin_installed(), "path": "/phpmyadmin"},
        "phppgadmin": {"installed": phppgadmin_installed(), "path": "/phppgadmin"},
    }


def install_pkg(pkg: str) -> jobs.Job:
    if pkg not in ("phppgadmin", "phpmyadmin", "postgresql", "mariadb-server"):
        raise DatabaseError("Unsupported package")
    env = {"DEBIAN_FRONTEND": "noninteractive", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}
    return jobs.launch(f"install {pkg}", ["apt-get", "-y", "install", pkg], env=env)
