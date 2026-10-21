"""APT package management (Debian / Raspberry Pi OS).

Read operations run synchronously; mutating/long ones (update, upgrade,
install, remove) run as background jobs so the HTTP request returns immediately.
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess

from . import jobs

IS_LINUX = platform.system() == "Linux"
# Non-interactive apt.
_APT_ENV = {"DEBIAN_FRONTEND": "noninteractive", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}

# Package names: letters, digits, + - . : (arch suffix). No spaces / shell metachars.
_PKG_RE = re.compile(r"^[a-z0-9][a-z0-9+._:-]*$", re.IGNORECASE)


class PackageError(RuntimeError):
    pass


def _require_apt():
    if not IS_LINUX or not shutil.which("apt-get"):
        raise PackageError("apt is not available on this host")


def _validate(pkg: str) -> str:
    if not _PKG_RE.match(pkg or ""):
        raise PackageError(f"Invalid package name: {pkg!r}")
    return pkg


def installed(limit: int = 500) -> list[dict]:
    if not IS_LINUX or not shutil.which("dpkg-query"):
        return []
    out = subprocess.run(
        ["dpkg-query", "-W", "-f=${Package}\t${Version}\t${Installed-Size}\t${binary:Summary}\n"],
        capture_output=True, text=True, timeout=30,
    )
    pkgs = []
    for line in out.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        name, version = parts[0], parts[1]
        size_kb = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        summary = parts[3] if len(parts) > 3 else ""
        pkgs.append({"name": name, "version": version, "size_kb": size_kb, "summary": summary})
    pkgs.sort(key=lambda p: p["name"])
    return pkgs[:limit]


def upgradable() -> list[dict]:
    _require_apt()
    out = subprocess.run(
        ["apt", "list", "--upgradable"],
        capture_output=True, text=True, timeout=30, env=_APT_ENV,
    )
    items = []
    for line in out.stdout.splitlines():
        # format: name/suite version arch [upgradable from: oldver]
        m = re.match(r"^([^/]+)/\S+\s+(\S+)\s+(\S+)\s+\[upgradable from:\s+([^\]]+)\]", line)
        if m:
            items.append({"name": m.group(1), "new_version": m.group(2), "arch": m.group(3), "current": m.group(4)})
    return items


def search(term: str, limit: int = 60) -> list[dict]:
    _require_apt()
    if not term or len(term) > 100 or any(c in term for c in "\n\r`$;|&"):
        raise PackageError("Invalid search term")
    out = subprocess.run(
        ["apt-cache", "search", "--names-only", term],
        capture_output=True, text=True, timeout=20, env=_APT_ENV,
    )
    results = []
    for line in out.stdout.splitlines()[:limit]:
        if " - " in line:
            name, _, summary = line.partition(" - ")
            results.append({"name": name.strip(), "summary": summary.strip()})
    return results


# ---- mutating operations (background jobs) ----
def job_update() -> jobs.Job:
    _require_apt()
    return jobs.launch("apt update", ["apt-get", "update"], env=_APT_ENV)


def job_upgrade() -> jobs.Job:
    _require_apt()
    return jobs.launch("apt upgrade", ["apt-get", "-y", "upgrade"], env=_APT_ENV)


def job_install(pkgs: list[str]) -> jobs.Job:
    _require_apt()
    valid = [_validate(p) for p in pkgs]
    if not valid:
        raise PackageError("No packages specified")
    return jobs.launch(f"install {' '.join(valid)}", ["apt-get", "-y", "install", *valid], env=_APT_ENV)


def job_remove(pkgs: list[str]) -> jobs.Job:
    _require_apt()
    valid = [_validate(p) for p in pkgs]
    if not valid:
        raise PackageError("No packages specified")
    return jobs.launch(f"remove {' '.join(valid)}", ["apt-get", "-y", "remove", *valid], env=_APT_ENV)
