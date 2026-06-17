"""Email + password auth. Mints our own JWT on success."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.security import encode_token, hash_password, verify_password
from app.domain.user import AuthResponse, Credentials, User
from app.persistence.repositories import UserRepository


class EmailAlreadyRegisteredError(AppError):
    status_code = 409
    code = "email_already_registered"


class InvalidCredentialsError(AppError):
    status_code = 401
    code = "invalid_credentials"


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._users = UserRepository(db)

    async def sign_up(self, payload: Credentials) -> AuthResponse:
        existing = await self._users.get_by_email(payload.email)
        if existing is not None:
            raise EmailAlreadyRegisteredError(
                f"An account with {payload.email} already exists"
            )
        row = await self._users.create(
            email=payload.email,
            password_hash=hash_password(payload.password),
        )
        await self._db.commit()
        token = encode_token(sub=row.id, email=row.email)
        return AuthResponse(access_token=token, user=User.model_validate(row))

    async def sign_in(self, payload: Credentials) -> AuthResponse:
        row = await self._users.get_by_email(payload.email)
        # Always run the verifier so timing doesn't leak which email exists.
        # bcrypt.checkpw on a junk hash takes the same ballpark time as on a
        # real one because it has to derive a key either way.
        valid_hash = (
            row.password_hash
            if row
            else "$2b$12$abcdefghijklmnopqrstuOhIuFRqAuBOyzlckSm89Q2pTd1eFoMVi"
        )
        if not verify_password(payload.password, valid_hash) or row is None:
            raise InvalidCredentialsError("Email or password is incorrect")
        await self._users.touch_last_seen(row.id)
        await self._db.commit()
        token = encode_token(sub=row.id, email=row.email)
        return AuthResponse(access_token=token, user=User.model_validate(row))
