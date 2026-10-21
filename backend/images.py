"""Images (cPanel "Images"): thumbnailer, scaler and converter.

Paths are relative to the File Manager root and confined to it (files._resolve).
Folder operations run as background jobs. Uses Pillow; originals are never
overwritten unless the user asks for it (the scaler can keep a copy)."""
from __future__ import annotations

from pathlib import Path

from . import files, jobs

EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"}
FORMATS = {"jpg": ("JPEG", ".jpg"), "png": ("PNG", ".png"), "webp": ("WEBP", ".webp"), "gif": ("GIF", ".gif"), "bmp": ("BMP", ".bmp")}


class ImageError(RuntimeError):
    pass


def _pil():
    try:
        from PIL import Image, ImageOps
        return Image, ImageOps
    except ImportError:
        raise ImageError("The image library (Pillow) isn't installed — run: .venv/bin/pip install Pillow")


def available() -> bool:
    try:
        _pil()
        return True
    except ImageError:
        return False


def _path(rel: str) -> Path:
    try:
        return files._resolve(rel)
    except files.FileError as exc:
        raise ImageError(str(exc))


def _images_in(folder: Path, recursive: bool) -> list[Path]:
    it = folder.rglob("*") if recursive else folder.iterdir()
    return sorted(p for p in it if p.is_file() and p.suffix.lower() in EXTS and "thumbnails" not in p.parts[len(folder.parts):-1])


def info(rel: str) -> dict:
    Image, _ = _pil()
    p = _path(rel)
    if p.is_dir():
        imgs = _images_in(p, False)
        return {"type": "folder", "path": files._rel(p), "count": len(imgs),
                "images": [{"name": i.name, "size": i.stat().st_size} for i in imgs[:500]]}
    if p.suffix.lower() not in EXTS:
        raise ImageError("Not an image file")
    with Image.open(p) as im:
        return {"type": "image", "path": files._rel(p), "width": im.width, "height": im.height,
                "format": im.format, "mode": im.mode, "size": p.stat().st_size}


def _save(im, dest: Path, fmt: str, quality: int):
    Image, _ = _pil()
    if fmt == "JPEG" and im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg.paste(im, mask=im.split()[-1])
        else:
            bg.paste(im.convert("RGB"))
        im = bg
    kw = {"quality": quality, "optimize": True} if fmt in ("JPEG", "WEBP") else {"optimize": True} if fmt == "PNG" else {}
    im.save(dest, fmt, **kw)


def _fmt_of(p: Path) -> str:
    return {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".gif": "GIF", ".bmp": "BMP", ".webp": "WEBP",
            ".tif": "TIFF", ".tiff": "TIFF"}[p.suffix.lower()]


def scale(rel: str, width: int | None, height: int | None, percent: int | None, keep_aspect: bool = True,
          keep_original: bool = True, quality: int = 85) -> dict:
    Image, ImageOps = _pil()
    p = _path(rel)
    if not p.is_file() or p.suffix.lower() not in EXTS:
        raise ImageError("Pick an image file")
    quality = max(30, min(int(quality or 85), 100))
    with Image.open(p) as src:
        im = ImageOps.exif_transpose(src)
        w0, h0 = im.size
        if percent:
            if not 1 <= int(percent) <= 1000:
                raise ImageError("Percent must be 1–1000")
            w, h = max(1, w0 * int(percent) // 100), max(1, h0 * int(percent) // 100)
        else:
            w, h = int(width or 0), int(height or 0)
            if w <= 0 and h <= 0:
                raise ImageError("Give a width, a height or a percentage")
            if keep_aspect:
                if w and h:
                    ratio = min(w / w0, h / h0)
                else:
                    ratio = (w / w0) if w else (h / h0)
                w, h = max(1, round(w0 * ratio)), max(1, round(h0 * ratio))
            else:
                w, h = w or w0, h or h0
        if w > 20000 or h > 20000:
            raise ImageError("That's too large (max 20000 px)")
        out = im.resize((w, h), Image.LANCZOS)
        backup = None
        if keep_original:
            backup = p.with_name(f"{p.stem}-original{p.suffix}")
            n = 1
            while backup.exists():
                backup = p.with_name(f"{p.stem}-original-{n}{p.suffix}")
                n += 1
            backup.write_bytes(p.read_bytes())
        _save(out, p, _fmt_of(p), quality)
    return {"ok": True, "path": files._rel(p), "from": [w0, h0], "to": [w, h],
            "original_kept_as": files._rel(backup) if backup else None}


def thumbnails(rel_dir: str, percent: int | None = 25, max_px: int | None = None, recursive: bool = False) -> jobs.Job:
    Image, ImageOps = _pil()
    folder = _path(rel_dir)
    if not folder.is_dir():
        raise ImageError("Pick a folder")
    if not percent and not max_px:
        raise ImageError("Give a percentage or a maximum size")

    def fn(log):
        imgs = _images_in(folder, recursive)
        log(f"• {len(imgs)} image(s) in {files._rel(folder) or '/'}")
        made = 0
        for img in imgs:
            out_dir = img.parent / "thumbnails"
            out_dir.mkdir(exist_ok=True)
            dest = out_dir / f"tn_{img.name}"
            try:
                with Image.open(img) as src:
                    im = ImageOps.exif_transpose(src)
                    if max_px:
                        im.thumbnail((int(max_px), int(max_px)), Image.LANCZOS)
                    else:
                        im = im.resize((max(1, im.width * int(percent) // 100), max(1, im.height * int(percent) // 100)), Image.LANCZOS)
                    _save(im, dest, _fmt_of(img), 85)
                made += 1
                log(f"  ✔ {files._rel(dest)} ({im.width}×{im.height})")
            except Exception as exc:
                log(f"  ✖ {img.name}: {exc}")
        log(f"✔ Created {made} thumbnail(s) in 'thumbnails' folders")
        return {"made": made}
    return jobs.launch_fn(f"Thumbnails: {files._rel(folder) or '/'}", fn)


def convert(rel: str, to: str, quality: int = 85, delete_original: bool = False) -> jobs.Job:
    Image, ImageOps = _pil()
    if to not in FORMATS:
        raise ImageError("Convert to jpg, png, webp, gif or bmp")
    fmt, ext = FORMATS[to]
    target = _path(rel)
    quality = max(30, min(int(quality or 85), 100))
    items = _images_in(target, False) if target.is_dir() else [target]
    if not target.is_dir() and target.suffix.lower() not in EXTS:
        raise ImageError("Not an image file")

    def fn(log):
        done = 0
        for img in items:
            if img.suffix.lower() == ext or (ext == ".jpg" and img.suffix.lower() == ".jpeg"):
                log(f"  • {img.name} is already {to}")
                continue
            dest = img.with_suffix(ext)
            n = 1
            while dest.exists():
                dest = img.with_name(f"{img.stem}-{n}{ext}")
                n += 1
            try:
                with Image.open(img) as src:
                    _save(ImageOps.exif_transpose(src), dest, fmt, quality)
                done += 1
                saved = img.stat().st_size - dest.stat().st_size
                log(f"  ✔ {img.name} → {dest.name} ({'saved' if saved >= 0 else 'grew'} {abs(saved) // 1024} KB)")
                if delete_original:
                    img.unlink()
            except Exception as exc:
                log(f"  ✖ {img.name}: {exc}")
        log(f"✔ Converted {done} image(s) to {to.upper()}")
        return {"converted": done}
    return jobs.launch_fn(f"Convert to {to.upper()}: {files._rel(target) or '/'}", fn)
