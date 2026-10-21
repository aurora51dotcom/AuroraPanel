"""Signed, expiring session tokens (stdlib only — no JWT dependency).

Token format:  base64url(payload).hex(hmac_sha256(secret, payload))
payload = "<username>:<expiry_epoch>"
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import Depends, HTTPException, Request, status

from . import config

SESSION_TTL_SECONDS = 60 * 60 * 8  # 8 hours
COOKIE_NAME = "aurora_session"


def _sign(payload: str) -> str:
    secret = config.session_secret().encode("utf-8")
    return hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def issue_token(username: str) -> str:
    expiry = int(time.time()) + SESSION_TTL_SECONDS
    payload = f"{username}:{expiry}"
    b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")
    return f"{b64}.{_sign(payload)}"


def verify_token(token: str) -> str | None:
    """Return the username if the token is valid + unexpired, else None."""
    try:
        b64, signature = token.split(".", 1)
        payload = base64.urlsafe_b64decode(b64.encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        username, expiry_str = payload.rsplit(":", 1)
        expiry = int(expiry_str)
    except ValueError:
        return None
    if time.time() > expiry:
        return None
    return username


def require_auth(request: Request) -> str:
    """FastAPI dependency: accept a valid session cookie OR an API token."""
    token = request.cookies.get(COOKIE_NAME)
    username = verify_token(token) if token else None
    if not username:
        # Fall back to an API token (Authorization: Bearer / X-Aurora-Token).
        from . import apitokens
        bearer = request.headers.get("authorization", "")
        api_tok = bearer[7:].strip() if bearer.lower().startswith("bearer ") else request.headers.get("x-aurora-token")
        name = apitokens.verify(api_tok) if api_tok else None
        if name:
            username = f"token:{name}"
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    return username


CurrentUser = Depends(require_auth)
