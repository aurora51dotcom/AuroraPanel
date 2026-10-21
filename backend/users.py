"""Linux user account management.

Listing parses /etc/passwd. Mutations shell out to useradd/userdel/usermod/passwd
with validated arguments. All mutations require the panel to run as root.
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess

from . import files

IS_LINUX = platform.system() == "Linux"
if IS_LINUX:
    import pwd  # Unix-only; not present on the Windows dev machine.
_NAME_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")


class UserError(RuntimeError):
    pass


def _require_linux():
    if not IS_LINUX:
        raise UserError("User management is only available on Linux")


def _validate_name(name: str) -> str:
    if not _NAME_RE.match(name or ""):
        raise UserError("Invalid username")
    return name


def list_users(include_system: bool = False) -> list[dict]:
    if not IS_LINUX:
        return []
    users = []
    for p in pwd.getpwall():
        is_system = p.pw_uid < 1000 and p.pw_uid != 0
        if is_system and not include_system:
            continue
        users.append({
            "name": p.pw_name,
            "uid": p.pw_uid,
            "gid": p.pw_gid,
            "home": p.pw_dir,
            "shell": p.pw_shell,
            "gecos": p.pw_gecos,
            "is_system": is_system,
        })
    users.sort(key=lambda u: u["uid"])
    return users


def add_user(name: str, create_home: bool = True, shell: str = "/bin/bash") -> dict:
    _require_linux()
    name = _validate_name(name)
    if shell not in ("/bin/bash", "/bin/sh", "/usr/sbin/nologin", "/bin/false"):
        raise UserError("Unsupported shell")
    argv = ["useradd", "-s", shell]
    if create_home:
        argv.append("-m")
    argv.append(name)
    out = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise UserError(out.stderr.strip() or "useradd failed")
    return {"ok": True, "name": name}


def delete_user(name: str, remove_home: bool = False) -> dict:
    _require_linux()
    name = _validate_name(name)
    owner = files.default_user()
    if name == "root" or (owner and name == owner.pw_name):
        raise UserError(f"Refusing to delete protected account '{name}'")
    argv = ["userdel"]
    if remove_home:
        argv.append("-r")
    argv.append(name)
    out = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise UserError(out.stderr.strip() or "userdel failed")
    return {"ok": True, "name": name}


def set_lock(name: str, locked: bool) -> dict:
    _require_linux()
    name = _validate_name(name)
    flag = "-L" if locked else "-U"
    out = subprocess.run(["usermod", flag, name], capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise UserError(out.stderr.strip() or "usermod failed")
    return {"ok": True, "name": name, "locked": locked}


def set_password(name: str, password: str) -> dict:
    """Set a Linux account password on behalf of the panel admin.

    The password is piped to `chpasswd` and never logged or stored by the panel.
    """
    _require_linux()
    name = _validate_name(name)
    if not password or len(password) < 6 or "\n" in password:
        raise UserError("Password must be at least 6 characters and single-line")
    if not shutil.which("chpasswd"):
        raise UserError("chpasswd not available")
    proc = subprocess.run(["chpasswd"], input=f"{name}:{password}\n", text=True, capture_output=True, timeout=20)
    if proc.returncode != 0:
        raise UserError(proc.stderr.strip() or "chpasswd failed")
    return {"ok": True, "name": name}
