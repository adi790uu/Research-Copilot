"""Password hashing + JWT issue/verify.

Why bcrypt directly (no passlib): passlib's bcrypt backend probes the
library at import time and breaks on bcrypt 5.x. The `bcrypt` C extension
itself is stable and tiny — we only need `hashpw` + `checkpw`.

Why our own HS256 JWT: single backend, single secret, no need for the
complexity of asymmetric keys. If we ever federate or hand tokens to a
different service, switch to RS256 and publish a JWKS — the rest of the
code only depends on `encode_token` / `decode_token` signatures.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings

# bcrypt accepts passwords up to 72 bytes. Pre-truncate so callers can pass
# arbitrarily long strings (e.g. a passphrase) without us blowing up; the
# truncation is the same one bcrypt would do silently in 3.x. 72 bytes
# already encodes ~72 ASCII chars or fewer multibyte chars, which is well
# beyond any realistic password.
_BCRYPT_MAX_BYTES = 72


def _bytes(plain: str) -> bytes:
    encoded = plain.encode("utf-8")
    return encoded[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_bytes(plain), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_bytes(plain), hashed.encode("utf-8"))
    except ValueError:
        # Malformed hash in the DB — treat as a failed verification rather
        # than crashing the request.
        return False


def encode_token(*, sub: str, email: str, extra: dict[str, Any] | None = None) -> str:
    """Mint a signed JWT for the given user.

    Claims: sub (user id), email, iss, iat, exp. Add extras only if you also
    teach `decode_token`'s consumers to read them.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "email": email,
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expires_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Verify and return the JWT payload. Raises `jwt.PyJWTError` on failure."""
    settings = get_settings()
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        issuer=settings.jwt_issuer,
        options={"require": ["sub", "exp", "iat"]},
    )
