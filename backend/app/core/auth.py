"""Bearer-token auth for protected endpoints.

Token format: HS256 JWT minted by us at sign-in / sign-up time. The
dependency reads `Authorization: Bearer <jwt>` and falls back to `?token=`
for clients that can't send headers (e.g. EventSource).
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Request

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.security import decode_token

log = get_logger(__name__)


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    # Fallback for clients that can't set headers (EventSource and friends).
    token = request.query_params.get("token")
    return token.strip() if token else None


async def get_current_user(request: Request) -> CurrentUser:
    token = _extract_bearer(request)
    if not token:
        raise UnauthorizedError("Missing bearer token")

    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError("Token expired") from exc
    except jwt.InvalidTokenError as exc:
        # Catches bad signature, wrong issuer, missing claim, etc.
        log.info("auth_failed", reason=str(exc))
        raise UnauthorizedError("Invalid token") from exc

    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise UnauthorizedError("Token missing identity claims")
    return CurrentUser(id=str(sub), email=str(email))
