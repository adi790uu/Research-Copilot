from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.domain.user import ActivitySummary, CompanyContext, User
from app.persistence.db import get_db_session
from app.services.company_context_draft import draft_company_context
from app.services.user_service import UserService

router = APIRouter(prefix="/me", tags=["users"])


class CompanyContextDraftRequest(BaseModel):
    website: str


@router.get("", response_model=User)
async def get_me(
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> User:
    return await UserService(db).me(user)


@router.put("/company-context", response_model=User)
async def update_company_context(
    payload: CompanyContext,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> User:
    return await UserService(db).update_company_context(user, payload)


@router.post("/company-context/draft", response_model=CompanyContext)
async def draft_company_context_from_site(
    payload: CompanyContextDraftRequest,
    user: CurrentUser = Depends(get_current_user),
) -> CompanyContext:
    """Scrape the given website and extract a draft company profile for the
    user to review. Nothing is saved — the client hydrates the form and the
    user Saves via PUT."""
    return await draft_company_context(payload.website)


@router.get("/activity", response_model=ActivitySummary)
async def get_activity(
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> ActivitySummary:
    return await UserService(db).activity(user)
