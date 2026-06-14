from dataclasses import dataclass

from clerk_backend_api.security import authenticate_request
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger(__name__)


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    """Set of session claims we care about. Add fields as the product grows."""


async def get_current_user(request: Request) -> CurrentUser:
    """FastAPI dependency: validate the Clerk session JWT and return the user.

    Reads `Authorization: Bearer <jwt>` from the request and verifies against
    Clerk's JWKS via the official SDK. Raises 401 on any failure.
    """
    settings = get_settings()
    if not settings.clerk_secret_key:
        # Fail loud in production; tests override this dependency.
        raise UnauthorizedError("Auth is not configured on this server")

    state = authenticate_request(
        request,
        AuthenticateRequestOptions(secret_key=settings.clerk_secret_key),
    )

    log.info("auth_state", status=str(state.status), has_payload=bool(state.payload), reason=str(state.reason) if state.reason else None)

    if not state.payload or not state.is_signed_in:
        log.info("auth_failed", reason=str(state.reason) if state.reason else "no_payload")
        raise UnauthorizedError("Not signed in")

    user_id = state.payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Token missing subject")

    # Email isn't always in the session token payload; Clerk puts it in `email`
    # if the JWT template includes it. Fall back to None.
    email = state.payload.get("email")

    return CurrentUser(id=user_id, email=email)
