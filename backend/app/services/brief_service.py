from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.errors import NotFoundError
from app.domain.brief import Brief, BriefCreate, BriefPage
from app.persistence.repositories import BriefRepository


class BriefService:
    """Brief CRUD scoped to one user. The auth dependency already proves the
    user exists; nothing here re-validates that — if the FK insert fails that's
    a real bug, not a missing user."""

    def __init__(self, db: AsyncSession, user: CurrentUser) -> None:
        self._db = db
        self._user = user
        self._repo = BriefRepository(db, user.id)

    async def create(self, payload: BriefCreate) -> Brief:
        row = await self._repo.create(
            company_name=payload.company_name,
            website=str(payload.website),
            objective=payload.objective,
        )
        await self._db.commit()
        return Brief.model_validate(row)

    async def get(self, brief_id: str) -> Brief:
        row = await self._repo.get(brief_id)
        if row is None:
            raise NotFoundError(f"Brief {brief_id} not found")
        return Brief.model_validate(row)

    async def list(self, *, limit: int = 50, offset: int = 0) -> BriefPage:
        rows, total = await self._repo.list(limit=limit, offset=offset)
        return BriefPage(
            items=[Brief.model_validate(r) for r in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
