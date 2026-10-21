"""Fix Home Permissions — reset a user's home directory to safe ownership +
permissions (mirrors cPanel's "Fix Home Permissions")."""
from __future__ import annotations

import os
import platform
import re
import stat
import subprocess
from pathlib import Path

IS_LINUX = platform.system() == "Linux"


class PermError(RuntimeError):
    pass


def _mounts_under(root: Path) -> set[str]:
    """Mount points (incl. bind mounts) strictly inside root, from /proc/self/mountinfo."""
    found = set()
    prefix = str(root).rstrip("/") + "/"
    try:
        for line in Path("/proc/self/mountinfo").read_text().splitlines():
            # field 5 = mount point, octal-escaped (\040 = space)
            mp = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), line.split()[4])
            if mp.startswith(prefix):
                found.add(mp)
    except (OSError, IndexError):
        pass
    return found


def fix_home(user: str) -> dict:
    if not IS_LINUX:
        raise PermError("Only available on Linux")
    if not re.match(r"^[a-z_][a-z0-9_-]{0,31}$", user or ""):
        raise PermError("Invalid username")
    import pwd
    try:
        info = pwd.getpwnam(user)
    except KeyError:
        raise PermError("No such user")
    home = Path(info.pw_dir)
    if not home.is_dir():
        raise PermError("Home directory does not exist")
    if str(home) in ("/", "/root") and user != "root":
        raise PermError("Refusing to touch that path")

    actions = []
    # Ownership: everything under home belongs to the user — but never descend into a
    # mount point. `chown -R` crosses bind mounts (same device, so -xdev can't tell), and a
    # bind-mounted /var under ~/sftp once got the whole of /var chowned to the user.
    skipped = _mounts_under(home)
    errors = []
    for dirpath, dirnames, filenames in os.walk(home):
        dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d) not in skipped]
        for name in [*dirnames, *filenames, ""]:
            p = os.path.join(dirpath, name) if name else dirpath
            try:
                os.chown(p, info.pw_uid, info.pw_gid, follow_symlinks=False)
            except OSError as e:
                errors.append(f"{p}: {e.strerror}")
    actions.append(("chown -R", not errors, "; ".join(errors[:5])))
    if skipped:
        actions.append((f"skipped mount points: {', '.join(sorted(skipped))}", True, ""))
    # Home directory itself -> 0711 (traversable, not world-readable).
    try:
        home.chmod(0o711)
        actions.append(("chmod 711 home", True, ""))
    except OSError as e:
        actions.append(("chmod 711 home", False, str(e)))
    # SSH hardening.
    ssh = home / ".ssh"
    if ssh.is_dir():
        try:
            ssh.chmod(0o700)
            for f in ssh.iterdir():
                if f.name in ("authorized_keys", "known_hosts", "config") or f.name.startswith("id_"):
                    f.chmod(0o600)
            actions.append((".ssh perms", True, ""))
        except OSError as e:
            actions.append((".ssh perms", False, str(e)))
    ok = all(a[1] for a in actions)
    return {"ok": ok, "user": user, "home": str(home),
            "actions": [{"action": a, "ok": b, "error": c} for a, b, c in actions]}
