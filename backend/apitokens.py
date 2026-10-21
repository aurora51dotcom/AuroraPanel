"""API Tokens — long-lived bearer tokens for programmatic access to the API.

Tokens are shown once at creation; only a SHA-256 hash is stored. Callers pass
`Authorization: Bearer <token>` (or `X-Aurora-Token: <token>`).
"""
from __future__ import annotations

import hashlib
import secrets
import time

from . import config


class APITokenError(RuntimeError):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load() -> list[dict]:
    return config.load_config().get("api_tokens", [])


def _save(tokens: list[dict]) -> None:
    cfg = config.load_config()
    cfg["api_tokens"] = tokens
    config.save_config(cfg)


def create(name: str) -> dict:
    name = (name or "").strip()
    if not name or len(name) > 60:
        raise APITokenError("Name is required (max 60 chars)")
    raw = "aur_" + secrets.token_urlsafe(24)
    tokens = _load()
    entry = {
        "id": secrets.token_hex(6),
        "name": name,
        "prefix": raw[:12],
        "hash": _hash(raw),
        "created": time.time(),
    }
    tokens.append(entry)
    _save(tokens)
    # Return the raw token ONCE — it can never be recovered later.
    return {"id": entry["id"], "name": name, "token": raw}


def listing() -> dict:
    return {"tokens": [{k: t[k] for k in ("id", "name", "prefix", "created") if k in t} for t in _load()]}


def revoke(token_id: str) -> dict:
    tokens = _load()
    kept = [t for t in tokens if t.get("id") != token_id]
    if len(kept) == len(tokens):
        raise APITokenError("Token not found")
    _save(kept)
    return {"ok": True}


def verify(token: str) -> str | None:
    """Return the token's name if valid, else None."""
    if not token:
        return None
    h = _hash(token)
    for t in _load():
        if secrets.compare_digest(t.get("hash", ""), h):
            return t.get("name", "api")
    return None
