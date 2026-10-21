"""Application Manager — register custom apps (Node/Python/Ruby/anything) as
systemd services. Mirrors cPanel's "Setup Node.js/Python/Ruby App".

Each app becomes a unit named  aurora-app-<slug>.service  so we can find and
manage exactly the ones the panel created (never touching system units).
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
from pathlib import Path

IS_LINUX = platform.system() == "Linux"
UNIT_DIR = Path("/etc/systemd/system")
PREFIX = "aurora-app-"
_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")


class AppError(RuntimeError):
    pass


def _require():
    if not (IS_LINUX and shutil.which("systemctl")):
        raise AppError("systemd is not available on this host")


def _unit_name(slug: str) -> str:
    if not _SLUG.match(slug or ""):
        raise AppError("Invalid app name (lowercase letters, digits, - and _)")
    return f"{PREFIX}{slug}.service"


def _systemctl(*args: str, timeout: int = 20) -> subprocess.CompletedProcess:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=timeout)


def list_apps() -> dict:
    if not (IS_LINUX and shutil.which("systemctl")):
        return {"supported": False, "apps": []}
    apps = []
    for unit in sorted(UNIT_DIR.glob(f"{PREFIX}*.service")):
        name = unit.name
        slug = name[len(PREFIX):-len(".service")]
        active = _systemctl("is-active", name).stdout.strip()
        enabled = _systemctl("is-enabled", name).stdout.strip()
        # Pull WorkingDirectory + ExecStart for display.
        workdir = command = ""
        try:
            for line in unit.read_text(errors="replace").splitlines():
                if line.startswith("WorkingDirectory="):
                    workdir = line.split("=", 1)[1]
                elif line.startswith("ExecStart="):
                    command = line.split("=", 1)[1]
                elif line.startswith("# aurora-command="):
                    command = line.split("=", 1)[1]
        except OSError:
            pass
        apps.append({"name": slug, "unit": name, "active": active, "enabled": enabled,
                     "workdir": workdir, "command": command})
    return {"supported": True, "apps": apps}


def create_app(name: str, workdir: str, command: str, autostart: bool = True) -> dict:
    _require()
    unit = _unit_name(name)
    wd = Path(workdir or "").expanduser()
    if not wd.is_absolute() or not wd.is_dir():
        raise AppError("Working directory must be an existing absolute path")
    cmd = (command or "").strip()
    if not cmd or "\n" in cmd or "\r" in cmd:
        raise AppError("Command is required and must be a single line")
    # Run through a login shell so `node app.js`, `python3 -m x`, etc. all work.
    # Escape for a double-quoted systemd arg + systemd's % specifier.
    esc = cmd.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    content = f"""[Unit]
Description=AuroraPanel app: {name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={wd}
# aurora-command={cmd}
ExecStart=/bin/sh -lc "{esc}"
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    (UNIT_DIR / unit).write_text(content, encoding="utf-8")
    _systemctl("daemon-reload")
    if autostart:
        _systemctl("enable", "--now", unit)
    return {"ok": True, "unit": unit}


def control_app(name: str, action: str) -> dict:
    _require()
    if action not in ("start", "stop", "restart", "enable", "disable"):
        raise AppError("Invalid action")
    unit = _unit_name(name)
    out = _systemctl(action, unit)
    if out.returncode != 0:
        raise AppError(out.stderr.strip() or f"systemctl {action} failed")
    return {"ok": True}


def remove_app(name: str) -> dict:
    _require()
    unit = _unit_name(name)
    _systemctl("disable", "--now", unit)
    path = UNIT_DIR / unit
    if path.exists():
        path.unlink()
    _systemctl("daemon-reload")
    return {"ok": True}


def logs(name: str, lines: int = 60) -> dict:
    _require()
    unit = _unit_name(name)
    out = subprocess.run(["journalctl", "-u", unit, "--no-pager", "-n", str(min(max(lines, 1), 500))],
                         capture_output=True, text=True, timeout=15)
    return {"output": out.stdout or "(no logs)"}
