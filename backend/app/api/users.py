from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.domain.user import ActivitySummary, User
from app.persistence.db import get_db_session
from app.services.user_service import UserService

router = APIRouter(prefix="/me", tags=["users"])


@router.get("", response_model=User)
async def get_me(
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> User:
    return await UserService(db).ensure_user(user)


@router.get("/activity", response_model=ActivitySummary)
async def get_activity(
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> ActivitySummary:
    return await UserService(db).activity(user)
