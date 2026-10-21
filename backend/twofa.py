"""TOTP two-factor auth (RFC 6238), stdlib only.

Secret + enabled flag live in the panel config. Enrollment returns an
otpauth:// URI the user adds to Google Authenticator / Authy etc.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time

from . import config

_DIGITS = 6
_PERIOD = 30


def _b32_secret() -> str:
    # 20 random bytes -> base32, no padding, as authenticator apps expect.
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _code_at(secret_b32: str, counter: int) -> str:
    # Restore base32 padding.
    pad = "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(secret_b32.upper() + pad)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    bincode = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(bincode % (10 ** _DIGITS)).zfill(_DIGITS)


def verify(secret_b32: str, code: str, window: int = 1) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != _DIGITS:
        return False
    counter = int(time.time() // _PERIOD)
    for delta in range(-window, window + 1):
        if hmac.compare_digest(_code_at(secret_b32, counter + delta), code):
            return True
    return False


def status() -> dict:
    cfg = config.load_config()
    return {"enabled": bool(cfg.get("totp_enabled")), "pending": bool(cfg.get("totp_secret") and not cfg.get("totp_enabled"))}


def begin_enroll(username: str) -> dict:
    """Generate (but don't yet enable) a secret; return provisioning details."""
    cfg = config.load_config()
    secret = _b32_secret()
    cfg["totp_secret"] = secret
    cfg["totp_enabled"] = False
    config.save_config(cfg)
    label = f"AuroraPanel:{username}"
    uri = (f"otpauth://totp/{label}?secret={secret}&issuer=AuroraPanel"
           f"&algorithm=SHA1&digits={_DIGITS}&period={_PERIOD}")
    return {"secret": secret, "otpauth_uri": uri}


def confirm_enable(code: str) -> bool:
    cfg = config.load_config()
    secret = cfg.get("totp_secret")
    if not secret:
        return False
    if not verify(secret, code):
        return False
    cfg["totp_enabled"] = True
    config.save_config(cfg)
    return True


def disable(code: str) -> bool:
    cfg = config.load_config()
    secret = cfg.get("totp_secret")
    if not cfg.get("totp_enabled") or not secret:
        return True
    if not verify(secret, code):
        return False
    cfg.pop("totp_secret", None)
    cfg["totp_enabled"] = False
    config.save_config(cfg)
    return True


def is_enabled() -> bool:
    return bool(config.load_config().get("totp_enabled"))


def verify_login(code: str) -> bool:
    cfg = config.load_config()
    secret = cfg.get("totp_secret")
    if not cfg.get("totp_enabled") or not secret:
        return True  # 2FA not enabled -> always passes
    return verify(secret, code)
