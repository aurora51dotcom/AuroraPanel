"""Select PHP Version — detect installed PHP versions and switch the CLI default."""
from __future__ import annotations

import glob
import platform
import re
import shutil
import subprocess
from pathlib import Path

IS_LINUX = platform.system() == "Linux"
_VER = re.compile(r"^\d+\.\d+$")


class PHPError(RuntimeError):
    pass


def status() -> dict:
    if not IS_LINUX:
        return {"supported": False, "installed": [], "current": None, "apache_module": None}
    # Installed CLI binaries: /usr/bin/php8.4 etc.
    versions = []
    for p in sorted(glob.glob("/usr/bin/php[0-9]*")):
        m = re.search(r"php(\d+\.\d+)$", p)
        if m:
            versions.append(m.group(1))
    current = None
    if shutil.which("php"):
        out = subprocess.run(["php", "-v"], capture_output=True, text=True, timeout=10)
        m = re.search(r"PHP (\d+\.\d+)", out.stdout)
        if m:
            current = m.group(1)
    # Apache handler module currently enabled.
    apache_module = None
    for f in glob.glob("/etc/apache2/mods-enabled/php*.load"):
        m = re.search(r"php(\d+\.\d+)\.load$", f)
        if m:
            apache_module = m.group(1)
    return {"supported": True, "installed": versions, "current": current, "apache_module": apache_module}


def set_cli_version(version: str) -> dict:
    if not IS_LINUX:
        raise PHPError("Only available on Linux")
    if not _VER.match(version or ""):
        raise PHPError("Invalid version")
    binpath = f"/usr/bin/php{version}"
    if not Path(binpath).exists():
        raise PHPError(f"php{version} is not installed")
    if not shutil.which("update-alternatives"):
        raise PHPError("update-alternatives not available")
    out = subprocess.run(["update-alternatives", "--set", "php", binpath], capture_output=True, text=True, timeout=15)
    if out.returncode != 0:
        raise PHPError(out.stderr.strip() or "Failed to switch PHP version")
    return {"ok": True, "current": version}
