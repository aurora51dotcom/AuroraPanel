"""systemd service control via `systemctl` (Linux only).

On non-Linux dev machines these return an empty list / raise a clear error,
so the panel remains usable for building the UI.
"""
from __future__ import annotations

import platform
import shutil
import subprocess

IS_LINUX = platform.system() == "Linux"
_ALLOWED_ACTIONS = {"start", "stop", "restart", "enable", "disable"}


class ServiceError(RuntimeError):
    pass


def _systemctl_available() -> bool:
    return IS_LINUX and shutil.which("systemctl") is not None


def list_services() -> list[dict]:
    if not _systemctl_available():
        return []
    try:
        out = subprocess.run(
            [
                "systemctl", "list-units", "--type=service", "--all",
                "--no-legend", "--no-pager", "--plain",
            ],
            capture_output=True, text=True, timeout=10,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ServiceError(str(exc)) from exc

    services = []
    for line in out.stdout.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        unit, load, active, sub = parts[:4]
        description = parts[4] if len(parts) > 4 else ""
        services.append(
            {
                "unit": unit,
                "load": load,
                "active": active,
                "sub": sub,
                "description": description,
            }
        )
    return services


def _validate_unit(unit: str) -> None:
    # Only allow a plain unit name; block anything that could smuggle args.
    if not unit or any(c.isspace() for c in unit) or unit.startswith("-"):
        raise ServiceError("Invalid service name")
    if not unit.endswith(".service"):
        unit_ok = unit.replace(".", "").replace("-", "").replace("_", "").replace("@", "")
        if not unit_ok.isalnum():
            raise ServiceError("Invalid service name")


def control_service(unit: str, action: str) -> dict:
    if action not in _ALLOWED_ACTIONS:
        raise ServiceError(f"Unsupported action: {action}")
    if not _systemctl_available():
        raise ServiceError("systemctl is not available on this host")
    _validate_unit(unit)
    try:
        out = subprocess.run(
            ["systemctl", action, unit],
            capture_output=True, text=True, timeout=20,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ServiceError(str(exc)) from exc
    if out.returncode != 0:
        raise ServiceError(out.stderr.strip() or f"systemctl {action} failed")
    return {"unit": unit, "action": action, "ok": True}


def service_status(unit: str) -> dict:
    if not _systemctl_available():
        raise ServiceError("systemctl is not available on this host")
    _validate_unit(unit)
    out = subprocess.run(
        ["systemctl", "status", unit, "--no-pager", "--lines=20"],
        capture_output=True, text=True, timeout=10,
    )
    return {"unit": unit, "output": out.stdout}
