"""A sandboxed file manager.

It opens in the web server's folder (e.g. /var/www/html) when one is installed,
otherwise in the default (non-root) user's home. Any path can be typed in, but
every operation is confined to the allowed folders: /var/www, each website's
document root and that user's home — or only AURORA_FILE_ROOT when it is set.
Paths in the API are absolute (relative ones start at the opening folder) and
are resolved and checked, so '..' and symlinks can't escape the allowed folders.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import time
import uuid
import zipfile
from pathlib import Path

from . import sysapps

# Never serve/edit files bigger than this through the text editor endpoints.
MAX_EDIT_BYTES = 2 * 1024 * 1024  # 2 MB


class FileError(RuntimeError):
    pass


def default_user():
    """The Pi's regular login (pwd entry) — the panel runs as root, so not the process user.
    AURORA_USER is set by install.sh; otherwise the first normal account under /home."""
    try:
        import pwd
        for name in (os.environ.get("SUDO_USER"), os.environ.get("AURORA_USER")):
            if name and name != "root":
                try:
                    return pwd.getpwnam(name)
                except KeyError:
                    pass
        users = sorted((u for u in pwd.getpwall() if 1000 <= u.pw_uid < 60000 and u.pw_dir.startswith("/home/")),
                       key=lambda u: u.pw_uid)
        if users and Path(users[0].pw_dir).is_dir():
            return users[0]
    except ImportError:
        pass
    return None


def _default_user_home() -> Path:
    u = default_user()
    return Path(u.pw_dir) if u else Path.home()


def file_root() -> Path:
    """The folder the File Manager opens in."""
    env = os.environ.get("AURORA_FILE_ROOT")
    if env:
        return Path(env).resolve()
    web = sysapps.web_root()
    return Path(web).resolve() if web else _default_user_home().resolve()


_roots_cache: tuple[float, list[Path]] = (0.0, [])


def allowed_roots() -> list[Path]:
    """Folders the File Manager may work in (see the module docstring)."""
    global _roots_cache
    if os.environ.get("AURORA_FILE_ROOT"):
        return [FILE_ROOT]
    if time.time() - _roots_cache[0] < 10:
        return _roots_cache[1]
    roots = [FILE_ROOT, _default_user_home().resolve()]
    if Path("/var/www").is_dir():
        roots.append(Path("/var/www").resolve())
    try:
        from . import sites
        for s in sites.list_sites().get("sites", []):
            if s.get("docroot") and Path(s["docroot"]).is_dir():
                roots.append(Path(s["docroot"]).resolve())
    except Exception:  # noqa: BLE001 — Apache missing or a conf it can't read: just fewer roots
        pass
    # Drop any root already inside another one; the system root is never one.
    out = []
    for r in sorted(set(roots), key=lambda p: len(p.parts)):
        if len(r.parts) > 1 and not any(r == o or o in r.parents for o in out):
            out.append(r)
    out.sort(key=lambda p: (not str(p).startswith("/var/www"), str(p)))
    _roots_cache = (time.time(), out)
    return out


def _allowed(p: Path) -> bool:
    return any(p == r or r in p.parents for r in allowed_roots())


def _trash_dir(root: Path) -> Path:
    # Inside a web root the bin would be downloadable over HTTP (e.g. a deleted
    # wp-config.php), so keep it outside, in the panel's state dir.
    if str(root).startswith("/var/www") or str(root).startswith("/usr/share"):
        return Path("/var/lib/aurora/file-trash")
    return root / ".aurora-trash"


# Resolved per request so installing/removing a web server moves the root.
FILE_ROOT = file_root()
TRASH_DIR = _trash_dir(FILE_ROOT)


def _refresh_root():
    global FILE_ROOT, TRASH_DIR
    FILE_ROOT = file_root()
    TRASH_DIR = _trash_dir(FILE_ROOT)


def _is_hidden(name: str) -> bool:
    return name.startswith(".")


def _resolve(path: str) -> Path:
    """Resolve a client-supplied path (absolute, or relative to FILE_ROOT) inside the allowed folders."""
    _refresh_root()
    p = (path or "").strip()
    candidate = Path(p).resolve() if p.startswith("/") else (FILE_ROOT / p.lstrip("\\")).resolve()
    if not _allowed(candidate):
        raise FileError("The File Manager can only open " + ", ".join(_rel(r) for r in allowed_roots()) + " and folders inside them")
    return candidate


def _rel(p: Path) -> str:
    """Paths as the API shows them: absolute."""
    return str(p).replace("\\", "/")


def list_dir(rel_path: str) -> dict:
    target = _resolve(rel_path)
    if not target.exists():
        raise FileError("No such directory")
    if not target.is_dir():
        raise FileError("Not a directory")

    entries = []
    with os.scandir(target) as it:
        for entry in it:
            # Never show the recycle bin as a normal folder.
            if target == TRASH_DIR.parent and entry.name == TRASH_DIR.name:
                continue
            try:
                st = entry.stat(follow_symlinks=False)
                is_dir = entry.is_dir(follow_symlinks=False)
                entries.append(
                    {
                        "name": entry.name,
                        "path": _rel(Path(entry.path)),
                        "is_dir": is_dir,
                        "is_symlink": entry.is_symlink(),
                        "is_hidden": _is_hidden(entry.name),
                        "size": st.st_size,
                        "modified": st.st_mtime,
                        "mode": stat.filemode(st.st_mode),
                    }
                )
            except OSError:
                continue

    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return {
        "root": _rel(FILE_ROOT),
        "roots": [_rel(r) for r in allowed_roots()],
        "cwd": _rel(target),
        "parent": _rel(target.parent) if _allowed(target.parent) else None,
        "entries": entries,
    }


def read_text(rel_path: str) -> dict:
    target = _resolve(rel_path)
    if not target.is_file():
        raise FileError("Not a file")
    if target.stat().st_size > MAX_EDIT_BYTES:
        raise FileError("File too large to edit in the browser")
    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise FileError("File is not UTF-8 text") from exc
    return {"path": _rel(target), "content": content}


def write_text(rel_path: str, content: str) -> dict:
    target = _resolve(rel_path)
    if target.is_dir():
        raise FileError("Cannot write to a directory")
    target.write_text(content, encoding="utf-8")
    return {"path": _rel(target), "size": target.stat().st_size}


def delete(rel_path: str, permanent: bool = False) -> dict:
    target = _resolve(rel_path)
    if target == FILE_ROOT or target in allowed_roots():
        raise FileError(f"Refusing to delete {_rel(target)} — it's one of the File Manager's main folders")
    if target == TRASH_DIR:
        raise FileError("Refusing to delete the recycle bin")
    if not target.exists() and not target.is_symlink():
        raise FileError("No such path")
    if permanent:
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink()
        return {"deleted": _rel(target), "permanent": True}
    # Soft delete -> recycle bin.
    TRASH_DIR.mkdir(parents=True, exist_ok=True)
    tid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"
    meta = {
        "id": tid,
        "name": target.name,
        "original": _rel(target),
        "original_parent": _rel(target.parent),
        "is_dir": target.is_dir(),
        "deleted_at": time.time(),
    }
    shutil.move(str(target), str(TRASH_DIR / tid))
    (TRASH_DIR / f"{tid}.json").write_text(json.dumps(meta), encoding="utf-8")
    return {"trashed": meta["original"], "id": tid}


# ---- Recycle bin ----
def list_trash() -> dict:
    _refresh_root()
    items = []
    if TRASH_DIR.exists():
        for meta_file in TRASH_DIR.glob("*.json"):
            try:
                m = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            data = TRASH_DIR / m["id"]
            size = 0
            try:
                size = data.stat().st_size if data.is_file() else _dir_size(data)
            except OSError:
                pass
            m["size"] = size
            m["exists"] = data.exists()
            items.append(m)
    items.sort(key=lambda x: x.get("deleted_at", 0), reverse=True)
    return {"items": items}


def _dir_size(p: Path) -> int:
    total = 0
    for root, _d, files in os.walk(p):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def restore_trash(tid: str, overwrite: bool = False) -> dict:
    if not _valid_tid(tid):
        raise FileError("Invalid id")
    _refresh_root()
    meta_file = TRASH_DIR / f"{tid}.json"
    data = TRASH_DIR / tid
    if not meta_file.exists() or not data.exists():
        raise FileError("Trash item not found")
    m = json.loads(meta_file.read_text(encoding="utf-8"))
    dest = _resolve(m["original"])
    if dest.exists():
        if not overwrite:
            raise FileError(f"'{m['name']}' already exists at the destination — enable overwrite to replace it")
        if dest.is_dir() and not dest.is_symlink():
            shutil.rmtree(dest)
        else:
            dest.unlink()
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(data), str(dest))
    meta_file.unlink()
    return {"restored": m["original"]}


def delete_trash(tid: str) -> dict:
    if not _valid_tid(tid):
        raise FileError("Invalid id")
    _refresh_root()
    data = TRASH_DIR / tid
    meta_file = TRASH_DIR / f"{tid}.json"
    if data.is_dir():
        shutil.rmtree(data, ignore_errors=True)
    elif data.exists():
        data.unlink()
    if meta_file.exists():
        meta_file.unlink()
    return {"ok": True}


def empty_trash() -> dict:
    _refresh_root()
    n = 0
    if TRASH_DIR.exists():
        for meta_file in list(TRASH_DIR.glob("*.json")):
            try:
                m = json.loads(meta_file.read_text(encoding="utf-8"))
                delete_trash(m["id"]); n += 1
            except (OSError, ValueError):
                continue
    return {"emptied": n}


def _valid_tid(tid: str) -> bool:
    import re
    return bool(re.match(r"^[0-9]+-[0-9a-f]{6}$", tid or ""))


# ---- Zip / Unzip ----
def zip_entries(rel_dir: str, names: list[str], archive_name: str, overwrite: bool = False) -> dict:
    parent = _resolve(rel_dir)
    if not parent.is_dir():
        raise FileError("Not a directory")
    if not names:
        raise FileError("Nothing selected to zip")
    safe_arc = os.path.basename(archive_name or "archive.zip")
    if not safe_arc.endswith(".zip"):
        safe_arc += ".zip"
    if "/" in archive_name or "\\" in archive_name or safe_arc in (".zip",):
        raise FileError("Invalid archive name")
    dest = _resolve(str(Path(_rel(parent)) / safe_arc))
    if dest.exists() and not overwrite:
        raise FileError("Archive already exists — enable overwrite to replace it")
    sources = []
    for name in names:
        base = os.path.basename(name)
        src = _resolve(str(Path(_rel(parent)) / base))
        if not src.exists():
            raise FileError(f"Not found: {base}")
        sources.append(src)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for src in sources:
            if src.is_dir():
                for root, _d, files in os.walk(src):
                    for f in files:
                        fp = Path(root) / f
                        zf.write(fp, str(fp.relative_to(parent)))
            else:
                zf.write(src, src.name)
    return {"archive": _rel(dest), "count": len(sources)}


def unzip(rel_path: str, overwrite: bool = False) -> dict:
    target = _resolve(rel_path)
    if not target.is_file() or target.suffix.lower() != ".zip":
        raise FileError("Not a .zip file")
    out_dir = target.with_suffix("")
    # If a folder of that name exists, extract into it (optionally overwriting).
    if out_dir.exists() and not overwrite:
        raise FileError(f"'{out_dir.name}' already exists — enable overwrite to extract into it")
    out_dir.mkdir(exist_ok=True)
    extracted = 0
    with zipfile.ZipFile(target, "r") as zf:
        for member in zf.namelist():
            # Guard against zip-slip.
            dest_path = (out_dir / member).resolve()
            if out_dir.resolve() != dest_path and out_dir.resolve() not in dest_path.parents:
                raise FileError("Unsafe path in archive")
        zf.extractall(out_dir)
        extracted = len(zf.namelist())
    return {"extracted_to": _rel(out_dir), "count": extracted}


def make_dir(rel_path: str, name: str) -> dict:
    parent = _resolve(rel_path)
    if not parent.is_dir():
        raise FileError("Parent is not a directory")
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise FileError("Invalid folder name")
    new_dir = _resolve(str(Path(_rel(parent)) / name))
    new_dir.mkdir(parents=False, exist_ok=False)
    return {"created": _rel(new_dir)}


def save_upload(rel_dir: str, filename: str, data: bytes) -> dict:
    parent = _resolve(rel_dir)
    if not parent.is_dir():
        raise FileError("Upload target is not a directory")
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name in (".", ".."):
        raise FileError("Invalid filename")
    dest = _resolve(str(Path(_rel(parent)) / safe_name))
    with open(dest, "wb") as fh:
        fh.write(data)
    return {"uploaded": _rel(dest), "size": len(data)}


def resolve_for_download(rel_path: str) -> Path:
    target = _resolve(rel_path)
    if not target.is_file():
        raise FileError("Not a file")
    return target
