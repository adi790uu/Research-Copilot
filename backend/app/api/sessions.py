from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.domain.session import Session, SessionCreate, SessionPage
from app.persistence.db import get_db_session
from app.services.session_service import SessionService

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=Session, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Session:
    return await SessionService(db, user).create(payload)


@router.get("", response_model=SessionPage)
async def list_sessions(
    limit: int = Query(default=10, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> SessionPage:
    return await SessionService(db, user).list(limit=limit, offset=offset)


@router.get("/{session_id}", response_model=Session)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> Session:
    return await SessionService(db, user).get(session_id)
