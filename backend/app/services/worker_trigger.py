"""Dispatch a phase-2 research run to the external TypeScript worker.

The worker is a Trigger.dev task ("deep-research"); we launch it over
Trigger.dev's REST trigger API. The worker reads the job/session from the
shared Postgres and writes results back, so the only thing we pass is the
identifiers plus the approved plan.
"""

from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


async def trigger_research_worker(
    *,
    job_id: str,
    session_id: str,
    user_id: str,
    research_plan: str,
) -> None:
    """Trigger the worker for `job_id`. Idempotent on `job_id`.

    No-ops (with a warning) when `trigger_secret_key` is unset so local
    dev / pre-deploy still creates the job row without a live worker.
    """
    settings = get_settings()
    if not settings.trigger_secret_key:
        log.warning("trigger_worker_skipped_no_secret", job_id=job_id)
        return

    url = (
        f"{settings.trigger_api_url.rstrip('/')}"
        f"/api/v1/tasks/{settings.trigger_task_id}/trigger"
    )
    body = {
        "payload": {
            "jobId": job_id,
            "sessionId": session_id,
            "userId": user_id,
            "researchPlan": research_plan,
        },
        "options": {"idempotencyKey": job_id},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url, json=body, headers={"Authorization": f"Bearer {settings.trigger_secret_key}"}
        )
        resp.raise_for_status()
    log.info("trigger_worker_dispatched", job_id=job_id)
