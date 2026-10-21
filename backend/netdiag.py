"""Track DNS / network diagnostics: dig, host, reverse lookup, traceroute."""
from __future__ import annotations

import re
import shutil
import subprocess

_HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")
_IP_RE = re.compile(r"^[0-9a-fA-F:.]{2,45}$")


class NetDiagError(RuntimeError):
    pass


def _valid_host(host: str) -> str:
    host = (host or "").strip()
    if not (_HOST_RE.match(host) or _IP_RE.match(host)):
        raise NetDiagError("Invalid hostname or IP")
    return host


def _run(argv: list[str], timeout: int = 20) -> str:
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise NetDiagError(f"{argv[0]} is not installed")
    except (subprocess.SubprocessError, OSError) as exc:
        raise NetDiagError(str(exc)) from exc
    return (out.stdout + (("\n" + out.stderr) if out.stderr else "")).strip()


def dns_records(host: str) -> dict:
    host = _valid_host(host)
    if not shutil.which("dig"):
        raise NetDiagError("dig is not installed (apt install dnsutils)")
    records = {}
    for rtype in ("A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"):
        out = _run(["dig", "+short", host, rtype], timeout=12)
        records[rtype] = [ln for ln in out.splitlines() if ln.strip()]
    return {"host": host, "records": records}


def reverse_lookup(ip: str) -> dict:
    ip = _valid_host(ip)
    if shutil.which("dig"):
        out = _run(["dig", "+short", "-x", ip], timeout=12)
    elif shutil.which("host"):
        out = _run(["host", ip], timeout=12)
    else:
        raise NetDiagError("dig/host not installed")
    return {"ip": ip, "result": out or "(no PTR record)"}


def ping(host: str, count: int = 4) -> dict:
    host = _valid_host(host)
    count = max(1, min(int(count), 10))
    if not shutil.which("ping"):
        raise NetDiagError("ping is not installed")
    out = _run(["ping", "-c", str(count), "-w", str(count + 5), host], timeout=count + 10)
    # Parse summary: "min/avg/max/mdev = 1.2/3.4/5.6/0.7 ms" and loss %.
    avg = None
    m = re.search(r"=\s*[\d.]+/([\d.]+)/", out)
    if m:
        avg = float(m.group(1))
    loss = None
    ml = re.search(r"([\d.]+)% packet loss", out)
    if ml:
        loss = float(ml.group(1))
    return {"host": host, "output": out, "avg_ms": avg, "loss_pct": loss}


def traceroute(host: str) -> dict:
    host = _valid_host(host)
    if shutil.which("traceroute"):
        out = _run(["traceroute", "-w", "2", "-q", "1", "-m", "20", host], timeout=60)
    elif shutil.which("tracepath"):
        out = _run(["tracepath", host], timeout=60)
    else:
        raise NetDiagError("Neither traceroute nor tracepath is installed (apt install traceroute)")
    return {"host": host, "output": out}
