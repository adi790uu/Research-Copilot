"""Automatic research from HubSpot: pick up deals in the configured stage,
run a brief through to a dispatched research job with no human in the loop,
and write the finished dashboard link back onto the deal as a Note.

Runs as a periodic background cycle (see main.py's lifespan), processing
deals one at a time — never in parallel — matching the ask that this reads
like a queue draining, not a fan-out.

Two passes per cycle, in this order:
1. Write-back — any deal already dispatched to research whose job has
   finished gets its Note written and is marked done. Checked first so a
   completed run is never left dangling behind a slow intake pass.
2. Intake — deals in the target stage not yet seen get a brief created,
   driven through phase 1 with clarification forced off (nobody is present
   to answer a clarifying question), and the plan auto-approved.
"""

from __future__ import annotations

from urllib.parse import urlparse

from app.core.auth import CurrentUser
from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.brief import BriefCreate
from app.persistence.db import get_sessionmaker
from app.persistence.repositories import HubspotDealSyncRepository, UserRepository
from app.services import hubspot_client, job_store
from app.services.brief_service import BriefService
from app.services.workflow_service import WorkflowService

log = get_logger(__name__)


async def run_sync_cycle(workflow_service: WorkflowService) -> None:
    settings = get_settings()
    if not settings.hubspot_access_token or not settings.hubspot_deal_stage_id:
        return
    if not settings.hubspot_owner_email:
        log.warning("hubspot_sync_skipped_no_owner")
        return

    owner = await _resolve_owner(settings.hubspot_owner_email)
    if owner is None:
        log.warning("hubspot_sync_owner_not_found", email=settings.hubspot_owner_email)
        return

    await _write_back_pass()
    await _intake_pass(owner, workflow_service)


async def _resolve_owner(email: str) -> CurrentUser | None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        row = await UserRepository(db).get_by_email(email)
    return CurrentUser(id=row.id, email=row.email) if row else None


# ─── Write-back: finished research -> Note on the deal ──────────────────────


async def _write_back_pass() -> None:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        pending = list(await HubspotDealSyncRepository(db).list_researching())

    for sync in pending:
        if not sync.job_id:
            continue
        job = await job_store.get_job(sync.job_id)
        if job is None:
            continue
        if job["status"] == "completed":
            await _write_back_one(sync.id, sync.deal_id, sync.brief_id or "")
        elif job["status"] == "failed":
            async with sessionmaker() as db:
                await HubspotDealSyncRepository(db).mark_failed(
                    sync.id, error="research job failed"
                )
                await db.commit()


async def _write_back_one(sync_id: str, deal_id: str, brief_id: str) -> None:
    settings = get_settings()
    dashboard_url = f"{settings.frontend_base_url.rstrip('/')}/app/sessions/{brief_id}"
    body_html = (
        f"<p>Research Copilot finished a briefing for this deal.</p>"
        f'<p><a href="{dashboard_url}">{dashboard_url}</a></p>'
    )
    sessionmaker = get_sessionmaker()
    try:
        contact_ids = await hubspot_client.get_deal_associations(deal_id, "contacts")
        await hubspot_client.create_note_with_association(
            body_html=body_html, deal_id=deal_id, contact_id=contact_ids[0] if contact_ids else None
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("hubspot_write_back_failed", deal_id=deal_id, error=str(exc))
        async with sessionmaker() as db:
            await HubspotDealSyncRepository(db).mark_failed(sync_id, error=str(exc))
            await db.commit()
        return

    async with sessionmaker() as db:
        await HubspotDealSyncRepository(db).mark_completed(sync_id)
        await db.commit()
    log.info("hubspot_write_back_done", deal_id=deal_id, brief_id=brief_id)


# ─── Intake: new deals -> brief -> dispatched job ────────────────────────────


async def _intake_pass(owner: CurrentUser, workflow_service: WorkflowService) -> None:
    settings = get_settings()
    try:
        deals = await hubspot_client.search_deals_in_stage(
            stage_id=settings.hubspot_deal_stage_id, pipeline_id=settings.hubspot_pipeline_id
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("hubspot_deal_search_failed", error=str(exc))
        return

    for deal in deals:
        deal_id = deal["id"]
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as db:
            existing = await HubspotDealSyncRepository(db).get_by_deal(deal_id)
            if existing is not None:
                continue
            sync = await HubspotDealSyncRepository(db).create(deal_id=deal_id)
            await db.commit()
            sync_id = sync.id

        try:
            await _process_deal(deal, owner, workflow_service, sync_id)
        except Exception as exc:  # noqa: BLE001
            log.exception("hubspot_deal_processing_failed", deal_id=deal_id)
            async with sessionmaker() as db:
                await HubspotDealSyncRepository(db).mark_failed(sync_id, error=str(exc))
                await db.commit()


async def _process_deal(
    deal: dict, owner: CurrentUser, workflow_service: WorkflowService, sync_id: str
) -> None:
    deal_id = deal["id"]
    props = deal.get("properties", {}) or {}

    company_ids = await hubspot_client.get_deal_associations(deal_id, "companies")
    if not company_ids:
        raise ValueError(f"deal {deal_id} has no associated company")
    company = await hubspot_client.get_object_properties(
        "companies", company_ids[0], ["name", "domain", "website"]
    )
    if not company or not company.get("name"):
        raise ValueError(f"deal {deal_id}'s company has no name")

    website = company.get("website") or _domain_to_url(company.get("domain") or "")
    if not website:
        raise ValueError(f"deal {deal_id}'s company has no domain/website")

    contact_ids = await hubspot_client.get_deal_associations(deal_id, "contacts")
    contact = None
    if contact_ids:
        contact = await hubspot_client.get_object_properties(
            "contacts", contact_ids[0], ["firstname", "lastname", "email"]
        )
    contact_name = None
    contact_email = None
    if contact:
        name_parts = [contact.get("firstname"), contact.get("lastname")]
        contact_name = " ".join(p for p in name_parts if p) or None
        contact_email = contact.get("email") or None

    objective = _build_objective(props)

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        brief = await BriefService(db, owner).create(
            BriefCreate(
                company_name=company["name"],
                website=website,  # type: ignore[arg-type]  # pydantic coerces str -> HttpUrl
                objective=objective,
                contact_name=contact_name,
                contact_email=contact_email,
            )
        )

    intro = f"Company Name: {company['name']}\nWebsite: {website}\nObjective: {objective}"
    resolution = brief.contact_resolution.model_dump() if brief.contact_resolution else None
    events = await workflow_service.run_phase1(
        brief_id=brief.id,
        user_id=owner.id,
        message=intro,
        is_start=True,
        allow_clarification=False,
        contact_name=contact_name,
        contact_email=contact_email,
        contact_resolution=resolution,
    )
    async for _ in events:
        pass  # drive the generator to completion (through clarify -> brief -> plan)

    job_id = await workflow_service.approve_plan(brief_id=brief.id, user_id=owner.id)

    async with sessionmaker() as db:
        await HubspotDealSyncRepository(db).mark_researching(
            sync_id, brief_id=brief.id, job_id=job_id
        )
        await db.commit()
    log.info("hubspot_intake_dispatched", deal_id=deal_id, brief_id=brief.id, job_id=job_id)


def _build_objective(deal_props: dict) -> str:
    name = deal_props.get("dealname") or "this deal"
    amount = deal_props.get("amount")
    parts = [f"Prepare for an upcoming sales conversation tied to the deal \"{name}\"."]
    if amount:
        parts.append(f"Deal value: {amount}.")
    return " ".join(parts)


def _domain_to_url(domain: str) -> str:
    if not domain:
        return ""
    return domain if urlparse(domain).scheme else f"https://{domain}"
