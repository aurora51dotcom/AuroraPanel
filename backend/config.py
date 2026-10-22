"""Configuration + credential storage for AuroraPanel.

The config lives in a JSON file next to the project root. The admin password is
never stored in plaintext: we keep a PBKDF2-HMAC-SHA256 hash + per-install salt.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
from pathlib import Path

# Project root = one level up from this backend/ package.
ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "aurora_config.json"

_PBKDF2_ITERATIONS = 200_000


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return dk.hex()


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def save_config(cfg: dict) -> None:
    tmp = CONFIG_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
    os.replace(tmp, CONFIG_PATH)


def is_initialized() -> bool:
    cfg = load_config()
    return bool(cfg.get("password_hash"))


def set_credentials(username: str, password: str) -> None:
    """Create/overwrite the admin credentials + a fresh session secret."""
    salt = secrets.token_hex(16)
    cfg = load_config()
    cfg["username"] = username
    cfg["salt"] = salt
    cfg["password_hash"] = _hash_password(password, salt)
    # Rotate the signing secret whenever credentials change -> invalidates old sessions.
    cfg["session_secret"] = secrets.token_hex(32)
    save_config(cfg)


def verify_credentials(username: str, password: str) -> bool:
    cfg = load_config()
    if not cfg.get("password_hash"):
        return False
    # Always hash, and compare both fields in constant time, so a wrong
    # username takes as long as a wrong password (no username probing).
    candidate = _hash_password(password, cfg["salt"])
    name_ok = secrets.compare_digest(username.encode("utf-8"), str(cfg.get("username", "")).encode("utf-8"))
    return secrets.compare_digest(candidate, cfg["password_hash"]) and name_ok


def session_secret() -> str:
    cfg = load_config()
    secret = cfg.get("session_secret")
    if not secret:
        secret = secrets.token_hex(32)
        cfg["session_secret"] = secret
        save_config(cfg)
    return secret


def change_password(new_password: str) -> None:
    """Update the admin password and rotate the session secret, which signs out
    every existing session (the caller re-issues a cookie for the current one)."""
    cfg = load_config()
    salt = secrets.token_hex(16)
    cfg["salt"] = salt
    cfg["password_hash"] = _hash_password(new_password, salt)
    cfg["session_secret"] = secrets.token_hex(32)
    save_config(cfg)


def get_prefs() -> dict:
    cfg = load_config()
    return {
        "username": cfg.get("username", ""),
        "contact_email": cfg.get("contact_email", ""),
        "language": cfg.get("language", "en"),
        "default_theme": cfg.get("default_theme", "dark"),
    }


def set_prefs(**kwargs) -> dict:
    cfg = load_config()
    for k in ("contact_email", "language", "default_theme"):
        if k in kwargs and kwargs[k] is not None:
            cfg[k] = kwargs[k]
    save_config(cfg)
    return get_prefs()


def rename_user(new_username: str) -> None:
    cfg = load_config()
    cfg["username"] = new_username
    save_config(cfg)
