from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.user import AuthResponse, Credentials
from app.persistence.db import get_db_session
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/sign-up",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
async def sign_up(
    payload: Credentials,
    db: AsyncSession = Depends(get_db_session),
) -> AuthResponse:
    return await AuthService(db).sign_up(payload)


@router.post("/sign-in", response_model=AuthResponse)
async def sign_in(
    payload: Credentials,
    db: AsyncSession = Depends(get_db_session),
) -> AuthResponse:
    return await AuthService(db).sign_in(payload)
