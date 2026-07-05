from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.domain.brief import Brief, BriefCreate, BriefPage
from app.persistence.repositories import BriefRepository
from app.services.contact_resolution import resolve_contact

log = get_logger(__name__)


class BriefService:
    def __init__(self, db: AsyncSession, user: CurrentUser) -> None:
        self._db = db
        self._user = user
        self._repo = BriefRepository(db, user.id)

    async def create(self, payload: BriefCreate) -> Brief:
        row = await self._repo.create(
            company_name=payload.company_name,
            website=str(payload.website),
            objective=payload.objective,
            contact_name=payload.contact_name,
            contact_email=payload.contact_email,
        )
        await self._db.commit()

        if payload.contact_name:
            try:
                resolution = await resolve_contact(
                    name=payload.contact_name,
                    email=payload.contact_email,
                    company_name=payload.company_name,
                    website=str(payload.website),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("contact_resolution_failed", brief_id=row.id, error=str(exc))
                resolution = {"status": "unresolved", "source": None}
            row = await self._repo.set_contact_resolution(row.id, resolution) or row
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
