"""Firewall management via ufw (Uncomplicated Firewall)."""
from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess

IS_LINUX = platform.system() == "Linux"

# Ports that must never be firewalled off, or the admin loses access to the box.
def _safe_ports() -> list[str]:
    panel_port = os.environ.get("PORT", "8088")
    return ["22", str(panel_port)]


class FirewallError(RuntimeError):
    pass


def _ufw() -> str:
    path = shutil.which("ufw") if IS_LINUX else None
    if not path:
        raise FirewallError("ufw is not installed (try installing it from Packages)")
    return path


def available() -> bool:
    return bool(IS_LINUX and shutil.which("ufw"))


def status() -> dict:
    if not available():
        return {"available": False, "active": False, "rules": []}
    out = subprocess.run([_ufw(), "status", "numbered"], capture_output=True, text=True, timeout=10)
    text = out.stdout
    active = "Status: active" in text
    rules = []
    for line in text.splitlines():
        m = re.match(r"^\[\s*(\d+)\]\s+(.*)", line.strip())
        if m:
            rules.append({"num": int(m.group(1)), "rule": re.sub(r"\s+", " ", m.group(2)).strip()})
    return {"available": True, "active": active, "rules": rules}


def set_enabled(enabled: bool) -> dict:
    ufw = _ufw()
    preallowed = []
    if enabled:
        # CRITICAL: allow SSH + the panel port BEFORE enabling, so a one-click
        # enable can never lock the admin out of the box (or the panel).
        for port in _safe_ports():
            subprocess.run([ufw, "allow", f"{port}/tcp"], capture_output=True, text=True, timeout=15)
            preallowed.append(f"{port}/tcp")
    # --force avoids the interactive y/n prompt on enable.
    argv = [ufw, "--force", "enable"] if enabled else [ufw, "disable"]
    out = subprocess.run(argv, capture_output=True, text=True, timeout=15)
    if out.returncode != 0:
        raise FirewallError(out.stderr.strip() or out.stdout.strip() or "ufw failed")
    return {"ok": True, "enabled": enabled, "preallowed": preallowed}


def guard_ports() -> list[str]:
    """The ports the panel protects from being firewalled off."""
    return _safe_ports()


def add_rule(action: str, port: str, proto: str = "tcp") -> dict:
    if action not in ("allow", "deny", "reject", "limit"):
        raise FirewallError("Invalid action")
    if not re.match(r"^\d{1,5}$", str(port)) or not (0 < int(port) < 65536):
        raise FirewallError("Invalid port")
    if proto not in ("tcp", "udp"):
        raise FirewallError("Invalid protocol")
    out = subprocess.run([_ufw(), action, f"{port}/{proto}"], capture_output=True, text=True, timeout=15)
    if out.returncode != 0:
        raise FirewallError(out.stderr.strip() or out.stdout.strip() or "ufw failed")
    return {"ok": True}


def delete_rule(num: int) -> dict:
    if not isinstance(num, int) or num < 1:
        raise FirewallError("Invalid rule number")
    # Refuse to delete a rule that keeps SSH / the panel reachable while ufw is
    # active — that is exactly the change that locks the admin out of the box.
    st = status()
    if st["active"]:
        rule = next((r["rule"] for r in st["rules"] if r["num"] == num), "")
        for port in _safe_ports():
            if re.search(rf"(^|\D){port}(/tcp)?(\s|$|\b)", rule) and "ALLOW" in rule.upper():
                raise FirewallError(
                    f"Refusing to delete the rule allowing port {port} while the "
                    f"firewall is active — it would lock you out. Disable the "
                    f"firewall first if you really mean to remove it.")
    # `ufw --force delete N` skips the confirmation prompt.
    out = subprocess.run([_ufw(), "--force", "delete", str(num)], capture_output=True, text=True, timeout=15)
    if out.returncode != 0:
        raise FirewallError(out.stderr.strip() or out.stdout.strip() or "ufw failed")
    return {"ok": True}
