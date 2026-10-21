"""Disk-usage explorer: per-child directory sizes for drill-down.

Uses `du` on Linux (fast, handles big trees); falls back to a Python walk
elsewhere so it still works on the dev machine.
"""
from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path

IS_LINUX = platform.system() == "Linux"


class DiskUsageError(RuntimeError):
    pass


def _safe_dir(path: str) -> Path:
    p = Path(path or "/").expanduser()
    if not p.is_absolute():
        raise DiskUsageError("Path must be absolute")
    p = p.resolve()
    if not p.exists():
        raise DiskUsageError("No such path")
    if not p.is_dir():
        raise DiskUsageError("Not a directory")
    return p


def _walk_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                continue
    return total


def children_sizes(path: str) -> dict:
    target = _safe_dir(path)
    entries = []

    if IS_LINUX:
        # One du call for all immediate children.
        try:
            out = subprocess.run(
                ["du", "-sb", "--", *[str(c) for c in _list_children(target)]],
                capture_output=True, text=True, timeout=120,
            )
            for line in out.stdout.splitlines():
                size_str, _, cpath = line.partition("\t")
                if size_str.isdigit() and cpath:
                    cp = Path(cpath)
                    entries.append({"name": cp.name, "path": str(cp), "size": int(size_str), "is_dir": cp.is_dir()})
        except (subprocess.SubprocessError, OSError) as exc:
            raise DiskUsageError(str(exc)) from exc
    else:
        for child in _list_children(target):
            try:
                size = _walk_size(child) if child.is_dir() else child.lstat().st_size
            except OSError:
                size = 0
            entries.append({"name": child.name, "path": str(child), "size": size, "is_dir": child.is_dir()})

    entries.sort(key=lambda e: e["size"], reverse=True)
    total = sum(e["size"] for e in entries)
    return {"path": str(target), "parent": str(target.parent) if target != target.parent else None,
            "total": total, "entries": entries}


def inodes(path: str) -> dict:
    """Inode (file + folder count) usage per child — like Disk Usage, but counting entries."""
    target = _safe_dir(path)
    fs = None
    if IS_LINUX:
        r = subprocess.run(["df", "--output=itotal,iused,iavail,ipcent,target", str(target)],
                           capture_output=True, text=True, timeout=30)
        rows = r.stdout.strip().splitlines()
        if len(rows) >= 2:
            f = rows[1].split()
            fs = {"total": int(f[0]), "used": int(f[1]), "free": int(f[2]), "percent": int(f[3].rstrip("%") or 0), "mount": f[4]}
    entries = []
    dev = target.stat().st_dev
    # Stay on this filesystem (skips /proc, /sys and other mounts — like du -x).
    children = [c for c in _list_children(target) if _same_dev(c, dev)]
    if IS_LINUX and children:
        out = subprocess.run(["du", "--inodes", "-s", "-x", "--", *[str(c) for c in children]],
                             capture_output=True, text=True, timeout=300)
        for line in out.stdout.splitlines():
            n, _, cpath = line.partition("\t")
            if n.isdigit() and cpath:
                cp = Path(cpath)
                entries.append({"name": cp.name, "path": str(cp), "inodes": int(n), "is_dir": cp.is_dir()})
    else:
        for c in children:
            cnt = 1
            if c.is_dir():
                for _r, dirs, fls in os.walk(c, onerror=lambda e: None):
                    cnt += len(dirs) + len(fls)
            entries.append({"name": c.name, "path": str(c), "inodes": cnt, "is_dir": c.is_dir()})
    entries.sort(key=lambda e: e["inodes"], reverse=True)
    return {"path": str(target), "parent": str(target.parent) if target != target.parent else None,
            "total": sum(e["inodes"] for e in entries), "filesystem": fs, "entries": entries}


def _same_dev(p: Path, dev: int) -> bool:
    try:
        return p.lstat().st_dev == dev
    except OSError:
        return False


def _list_children(target: Path) -> list[Path]:
    children = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                children.append(Path(entry.path))
    except OSError as exc:
        raise DiskUsageError(str(exc)) from exc
    return children
