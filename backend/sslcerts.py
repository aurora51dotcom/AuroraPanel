"""SSL/TLS Certificates — list/inspect existing certs and generate self-signed."""
from __future__ import annotations

import ipaddress
import os
import re
import shutil
import subprocess
from pathlib import Path

CERT_DIR = Path(os.environ.get("AURORA_CERT_DIR", str(Path.home() / "aurora-certs"))).resolve()
_SCAN_DIRS = ["/etc/letsencrypt/live", "/etc/ssl/certs", "/etc/apache2/ssl", str(CERT_DIR)]
_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class SSLCertError(RuntimeError):
    pass


def _openssl() -> str:
    p = shutil.which("openssl")
    if not p:
        raise SSLCertError("openssl is not installed")
    return p


def _inspect(path: Path) -> dict | None:
    try:
        out = subprocess.run(
            [_openssl(), "x509", "-in", str(path), "-noout", "-subject", "-issuer", "-enddate", "-startdate"],
            capture_output=True, text=True, timeout=10)
    except (subprocess.SubprocessError, OSError, SSLCertError):
        return None
    if out.returncode != 0:
        return None
    d = {"path": str(path), "name": path.name}
    for line in out.stdout.splitlines():
        if line.startswith("subject="):
            d["subject"] = line[len("subject="):].strip()
        elif line.startswith("issuer="):
            d["issuer"] = line[len("issuer="):].strip()
        elif line.startswith("notAfter="):
            d["expires"] = line[len("notAfter="):].strip()
        elif line.startswith("notBefore="):
            d["starts"] = line[len("notBefore="):].strip()
    d["self_signed"] = d.get("subject") == d.get("issuer")
    return d


def list_certs() -> dict:
    certs = []
    seen = set()
    for base in _SCAN_DIRS:
        b = Path(base)
        if not b.exists():
            continue
        # letsencrypt/live/<domain>/fullchain.pem, or *.pem/*.crt files
        candidates = list(b.glob("**/fullchain.pem")) + list(b.glob("*.pem")) + list(b.glob("*.crt"))
        for c in candidates[:200]:
            if str(c) in seen:
                continue
            seen.add(str(c))
            info = _inspect(c)
            if info:
                certs.append(info)
    return {"cert_dir": str(CERT_DIR), "certs": certs}


def generate_self_signed(common_name: str, days: int = 365) -> dict:
    cn = (common_name or "").strip()
    if not re.match(r"^[A-Za-z0-9.*_-]{1,253}$", cn):
        raise SSLCertError("Invalid common name / hostname")
    if not (1 <= int(days) <= 3650):
        raise SSLCertError("Days must be 1–3650")
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    safe = cn.replace("*", "wildcard")
    key = CERT_DIR / f"{safe}.key"
    crt = CERT_DIR / f"{safe}.crt"
    out = subprocess.run(
        [_openssl(), "req", "-x509", "-nodes", "-newkey", "rsa:2048",
         "-keyout", str(key), "-out", str(crt), "-days", str(int(days)),
         "-subj", f"/CN={cn}"],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise SSLCertError(out.stderr.strip() or "openssl failed")
    try:
        key.chmod(0o600)
    except OSError:
        pass
    return {"ok": True, "cert": str(crt), "key": str(key)}


def valid_cert_name(name: str) -> bool:
    """A DNS name or IP address that can go in a certificate SAN."""
    name = (name or "").strip().strip("[]").rstrip(".")
    if not name or len(name) > 253:
        return False
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        pass
    return bool(re.match(
        r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$",
        name))


def san_token(name: str) -> str:
    name = name.strip().strip("[]")
    if not valid_cert_name(name):
        raise SSLCertError(f"Can't put {name!r} on a certificate")
    try:
        ipaddress.ip_address(name)
        return f"IP:{name}"
    except ValueError:
        return f"DNS:{name}"


def subject_alt_names(path: Path) -> list[str]:
    """SAN entries as 'IP:…' / 'DNS:…'. Empty when the certificate has none."""
    try:
        out = subprocess.run(
            [_openssl(), "x509", "-in", str(path), "-noout", "-ext", "subjectAltName"],
            capture_output=True, text=True, timeout=10)
    except (subprocess.SubprocessError, OSError, SSLCertError):
        return []
    found = []
    for kind, value in re.findall(r"(DNS|IP Address|IP):\s*([^,\s]+)", out.stdout or ""):
        prefix = "IP" if kind.startswith("IP") else "DNS"
        found.append(f"{prefix}:{value}")
    return found


def covers_host(path: Path, host: str) -> bool:
    """True when `host` is this certificate's SAN or, failing that, its CN."""
    if not path.is_file():
        return False
    want = host.strip().strip("[]").lower().rstrip(".")
    for entry in subject_alt_names(path):
        value = entry.split(":", 1)[-1].strip().strip("[]").lower().rstrip(".")
        if value == want:
            return True
    info = _inspect(path) or {}
    match = re.search(r"CN\s*=\s*([^,/]+)", info.get("subject") or "")
    return bool(match and match.group(1).strip().lower().rstrip(".") == want)


def read_pem(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    blocks = re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", text, re.S)
    if not blocks:
        raise SSLCertError("That file is not a PEM certificate")
    return "\n".join(blocks) + "\n"


def describe_cert(path: Path) -> dict | None:
    info = _inspect(path)
    if not info:
        return None
    raw = subject_alt_names(path)
    info["san"] = raw
    info["names"] = [entry.split(":", 1)[1] for entry in raw]
    if not info["names"]:
        match = re.search(r"CN\s*=\s*([^,/]+)", info.get("subject") or "")
        if match:
            info["names"] = [match.group(1).strip()]
    try:
        info["pem"] = read_pem(path)
    except (OSError, SSLCertError):
        info["pem"] = None
    return info


def write_self_signed(crt: Path, key: Path, names: list[str], days: int = 825) -> None:
    """Write a self-signed certificate covering every name (DNS and IP)."""
    clean = []
    for name in names:
        name = (name or "").strip().strip("[]").rstrip(".")
        if name and name not in clean:
            if not valid_cert_name(name):
                raise SSLCertError(f"Can't put {name!r} on a certificate")
            clean.append(name)
    if not clean:
        raise SSLCertError("No names for the certificate")
    if not (1 <= int(days) <= 3650):
        raise SSLCertError("Days must be 1–3650")
    cn = next((n for n in clean if len(n) <= 64), clean[0][:64])
    crt.parent.mkdir(parents=True, exist_ok=True)
    tmp_key, tmp_crt = key.with_name(key.name + ".tmp"), crt.with_name(crt.name + ".tmp")
    try:
        out = subprocess.run(
            [_openssl(), "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", str(int(days)),
             "-keyout", str(tmp_key), "-out", str(tmp_crt), "-subj", f"/CN={cn}",
             "-addext", "subjectAltName=" + ",".join(san_token(n) for n in clean)],
            capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            raise SSLCertError(out.stderr.strip() or "openssl failed")
        tmp_key.chmod(0o600)
        os.replace(tmp_key, key)
        os.replace(tmp_crt, crt)
        key.chmod(0o600)
    finally:
        tmp_key.unlink(missing_ok=True)
        tmp_crt.unlink(missing_ok=True)
