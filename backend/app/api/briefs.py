from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.domain.brief import Brief, BriefCreate, BriefPage
from app.persistence.db import get_db_session
from app.services.brief_service import BriefService

router = APIRouter(prefix="/briefs", tags=["briefs"])


@router.post("", response_model=Brief, status_code=status.HTTP_201_CREATED)
async def create_brief(
    payload: BriefCreate,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Brief:
    return await BriefService(db, user).create(payload)


@router.get("", response_model=BriefPage)
async def list_briefs(
    limit: int = Query(default=10, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> BriefPage:
    return await BriefService(db, user).list(limit=limit, offset=offset)


@router.get("/{brief_id}", response_model=Brief)
async def get_brief(
    brief_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Brief:
    return await BriefService(db, user).get(brief_id)
