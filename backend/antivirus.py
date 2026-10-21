"""Virus scanner via ClamAV (clamscan). Scans run as background jobs."""
from __future__ import annotations

import os
import platform
import shutil
from pathlib import Path

from . import jobs

IS_LINUX = platform.system() == "Linux"
_COUNT_CAP = 500_000  # stop counting beyond this (progress becomes approximate)


class AntivirusError(RuntimeError):
    pass


def available() -> bool:
    return bool(IS_LINUX and shutil.which("clamscan"))


def status() -> dict:
    return {
        "available": available(),
        "clamscan": shutil.which("clamscan"),
        "freshclam": shutil.which("freshclam"),
    }


def _count_files(target: Path) -> int:
    if target.is_file():
        return 1
    total = 0
    for _root, _dirs, files in os.walk(target, onerror=lambda e: None):
        total += len(files)
        if total >= _COUNT_CAP:
            break
    return total


def scan(path: str, recursive: bool = True) -> jobs.Job:
    if not available():
        raise AntivirusError("ClamAV (clamscan) is not installed. Install 'clamav' from Packages.")
    target = Path(path or "").expanduser()
    if not target.is_absolute():
        raise AntivirusError("Scan path must be absolute")
    target = target.resolve()
    if not target.exists():
        raise AntivirusError("Path does not exist")

    total_files = _count_files(target)
    # NOTE: no --infected here, so clamscan prints one "<file>: OK|FOUND" line per
    # file — that per-file stream drives the progress bar. `stdbuf -oL` forces
    # line-buffered stdout so lines arrive live instead of in one dump at the end.
    prefix = ["stdbuf", "-oL"] if shutil.which("stdbuf") else []
    argv = prefix + ["clamscan", "--stdout"]
    if recursive:
        argv.append("-r")
    argv.append(str(target))
    # clamscan exits 1 when it finds a virus — that's a successful scan, not an
    # error — so mark rc 1 as "ok" for this job.
    return jobs.launch(f"clamscan {target}", argv,
                       meta={"kind": "clamscan", "total_files": total_files,
                             "path": str(target), "ok_returncodes": [0, 1]})


def update_db() -> jobs.Job:
    if not (IS_LINUX and shutil.which("freshclam")):
        raise AntivirusError("freshclam is not installed")
    return jobs.launch("freshclam (update virus DB)", ["freshclam"])
