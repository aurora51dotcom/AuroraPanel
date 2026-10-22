"""HTTPS for the panel itself (the uvicorn port, 8088 by default).

uvicorn reads UVICORN_SSL_CERTFILE / UVICORN_SSL_KEYFILE from its environment,
so turning HTTPS on is just a systemd drop-in next to aurorapanel.service — the
unit that install.sh writes (and rewrites on every update) stays untouched.

Switching is lockout-safe: before the restart a transient timer is armed that
deletes the drop-in and restarts the panel on plain HTTP again, unless the
browser confirms within REVERT_SECONDS that it reached the panel over HTTPS.
"""
from __future__ import annotations

import os
import shutil
import socket
import ssl
import subprocess
import time
from pathlib import Path

import psutil

SERVICE = "aurorapanel"
DROPIN = Path(f"/etc/systemd/system/{SERVICE}.service.d/aurora-https.conf")
TLS_DIR = Path("/var/lib/aurora/panel-tls")
SELF_CRT = TLS_DIR / "panel.crt"
SELF_KEY = TLS_DIR / "panel.key"
PENDING = TLS_DIR / "pending"
LE_LIVE = Path("/etc/letsencrypt/live")
LE_HOOK = Path(f"/etc/letsencrypt/renewal-hooks/deploy/{SERVICE}-restart")
REVERT_UNIT = f"{SERVICE}-https-revert"
REVERT_SECONDS = 180


class PanelHttpsError(RuntimeError):
    pass


def _run(argv: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(argv, 1, "", str(e))


def _port() -> int:
    try:
        return int(os.environ.get("PORT", "8088"))
    except ValueError:
        return 8088


def _local_ips() -> list[str]:
    ips = []
    for addrs in psutil.net_if_addrs().values():
        for a in addrs:
            if a.family == socket.AF_INET and not a.address.startswith(("127.", "169.254.")):
                ips.append(a.address)
    return sorted(set(ips))


def _dropin_paths() -> tuple[str, str] | None:
    """(certfile, keyfile) from the drop-in, or None when HTTPS is off."""
    if not DROPIN.is_file():
        return None
    env = {}
    for line in DROPIN.read_text(encoding="utf-8").splitlines():
        if line.startswith("Environment=") and "=" in line[12:]:
            k, v = line[12:].split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    if env.get("UVICORN_SSL_CERTFILE") and env.get("UVICORN_SSL_KEYFILE"):
        return env["UVICORN_SSL_CERTFILE"], env["UVICORN_SSL_KEYFILE"]
    return None


def _cert_info(crt: str) -> dict:
    r = _run(["openssl", "x509", "-in", crt, "-noout", "-subject", "-enddate", "-ext", "subjectAltName"])
    info = {"subject": "", "expires": "", "names": []}
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("subject="):
            info["subject"] = line[8:].strip()
        elif line.startswith("notAfter="):
            info["expires"] = line[9:].strip()
        elif "DNS:" in line or "IP Address:" in line:
            info["names"] = [n.split(":", 1)[1].strip() for n in line.split(",") if ":" in n]
    return info


def _le_certs() -> list[str]:
    if not LE_LIVE.is_dir():
        return []
    return sorted(d.name for d in LE_LIVE.iterdir()
                  if (d / "fullchain.pem").is_file() and (d / "privkey.pem").is_file())


def _pending_deadline() -> float | None:
    try:
        deadline = float(PENDING.read_text().strip())
    except (OSError, ValueError):
        return None
    return deadline if deadline > time.time() else None


def status(scheme: str) -> dict:
    paths = _dropin_paths()
    deadline = _pending_deadline()
    source = None
    if paths:
        source = "self" if paths[0] == str(SELF_CRT) else Path(paths[0]).parent.name
    return {
        "enabled": bool(paths),
        "active": scheme == "https",
        "source": source,
        "cert": _cert_info(paths[0]) if paths else None,
        "pending": bool(deadline),
        "revert_in": int(deadline - time.time()) if deadline else 0,
        "letsencrypt": _le_certs(),
        "port": _port(),
        "hostname": socket.gethostname(),
        "ips": _local_ips(),
    }


def _make_self_signed():
    """A self-signed cert valid for this Pi's hostname, hostname.local and every
    local IPv4 address (825 days: the longest Apple devices accept)."""
    host = socket.gethostname()
    names = [f"DNS:{host}", f"DNS:{host}.local", "DNS:localhost", "IP:127.0.0.1"]
    names += [f"IP:{ip}" for ip in _local_ips()]
    TLS_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(TLS_DIR, 0o700)
    tmp_key, tmp_crt = TLS_DIR / "panel.key.new", TLS_DIR / "panel.crt.new"
    r = _run(["openssl", "req", "-x509", "-nodes",
              "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
              "-keyout", str(tmp_key), "-out", str(tmp_crt), "-days", "825",
              "-subj", f"/CN={host}/O=AuroraPanel",
              "-addext", "subjectAltName=" + ",".join(names),
              "-addext", "basicConstraints=critical,CA:FALSE",
              "-addext", "keyUsage=critical,digitalSignature",
              "-addext", "extendedKeyUsage=serverAuth"], timeout=60)
    if r.returncode != 0:
        raise PanelHttpsError(r.stderr.strip() or "openssl failed")
    os.chmod(tmp_key, 0o600)
    tmp_key.replace(SELF_KEY)
    tmp_crt.replace(SELF_CRT)


def _check_pair(crt: str, key: str):
    """Load the pair exactly as uvicorn will, so a bad cert can't stop the panel from starting."""
    try:
        ssl.create_default_context(ssl.Purpose.CLIENT_AUTH).load_cert_chain(crt, key)
    except (ssl.SSLError, OSError) as e:
        raise PanelHttpsError(f"That certificate can't be used: {e}")


def _set_le_hook(on: bool):
    """certbot renews the files in place; uvicorn only reads them at start."""
    if on:
        LE_HOOK.parent.mkdir(parents=True, exist_ok=True)
        LE_HOOK.write_text(f"#!/bin/sh\n# Written by AuroraPanel: reload the panel's renewed certificate.\n"
                           f"systemctl try-restart {SERVICE}\n", encoding="utf-8")
        os.chmod(LE_HOOK, 0o755)
    else:
        LE_HOOK.unlink(missing_ok=True)


def _stop_revert():
    _run(["systemctl", "stop", f"{REVERT_UNIT}.timer", f"{REVERT_UNIT}.service"])
    _run(["systemctl", "reset-failed", f"{REVERT_UNIT}.timer", f"{REVERT_UNIT}.service"])
    PENDING.unlink(missing_ok=True)


def _restart_soon():
    """Restart from outside the service's cgroup, after this response has gone out."""
    unit = f"{SERVICE}-restart-{int(time.time())}"
    # Transient timers default to AccuracySec=1min, which would delay this by up to a minute.
    r = _run(["systemd-run", "--quiet", "--collect", f"--unit={unit}", "--on-active=2",
              "--timer-property=AccuracySec=100ms", "systemctl", "restart", SERVICE])
    if r.returncode != 0:
        raise PanelHttpsError(r.stderr.strip() or "Couldn't schedule the panel restart")


def enable(source: str, regenerate: bool = False) -> dict:
    if not shutil.which("systemd-run"):
        raise PanelHttpsError("systemd is required")
    if source == "self":
        if regenerate or not (SELF_CRT.is_file() and SELF_KEY.is_file()):
            _make_self_signed()
        crt, key = str(SELF_CRT), str(SELF_KEY)
    elif source in _le_certs():
        crt, key = str(LE_LIVE / source / "fullchain.pem"), str(LE_LIVE / source / "privkey.pem")
    else:
        raise PanelHttpsError("Unknown certificate")
    _check_pair(crt, key)

    # Arm the safety net first: back to HTTP unless the browser confirms over HTTPS.
    _stop_revert()
    TLS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING.write_text(str(time.time() + REVERT_SECONDS))
    revert = (f"rm -f '{DROPIN}' '{PENDING}' '{LE_HOOK}'; systemctl daemon-reload; "
              f"systemctl restart {SERVICE}")
    r = _run(["systemd-run", "--quiet", "--collect", f"--unit={REVERT_UNIT}",
              f"--on-active={REVERT_SECONDS}", "--timer-property=AccuracySec=1s",
              "/bin/sh", "-c", revert])
    if r.returncode != 0:
        PENDING.unlink(missing_ok=True)
        raise PanelHttpsError(r.stderr.strip() or "Couldn't arm the automatic revert")

    DROPIN.parent.mkdir(parents=True, exist_ok=True)
    DROPIN.write_text(
        "# Written by AuroraPanel (Security → Panel HTTPS). Delete this file and run\n"
        f"# 'systemctl daemon-reload && systemctl restart {SERVICE}' to go back to HTTP.\n"
        "[Service]\n"
        f"Environment=UVICORN_SSL_CERTFILE={crt}\n"
        f"Environment=UVICORN_SSL_KEYFILE={key}\n", encoding="utf-8")
    _set_le_hook(source != "self")
    _run(["systemctl", "daemon-reload"])
    _restart_soon()
    return {"ok": True, "revert_in": REVERT_SECONDS,
            "host": source if source != "self" else None, "port": _port()}


def confirm(scheme: str) -> dict:
    """Called by the browser once it has loaded the panel over HTTPS."""
    if scheme != "https":
        raise PanelHttpsError("Open the panel over https:// to confirm")
    _stop_revert()
    return {"ok": True}


def disable() -> dict:
    _stop_revert()
    if DROPIN.is_file():
        DROPIN.unlink()
        _set_le_hook(False)
        _run(["systemctl", "daemon-reload"])
        _restart_soon()
    return {"ok": True, "port": _port()}
