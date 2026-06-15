"""End-to-end POST /run + GET /stream against MemorySaver + a patched workflow service.

Postgres-gated: the API depends on the lifespan-managed sessionmaker, so the
test skips when Postgres is unreachable.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import MemorySaver

from app.core.auth import CurrentUser, get_current_user
from app.domain.events import ReportReady, RunStarted
from app.domain.report import ReportContent, ReportSection
from app.main import create_app
from app.persistence.db import get_sessionmaker
from app.persistence.repositories import ReportRepository, SessionRepository
from app.services.event_bus import WorkflowEventBus
from app.services.workflow_service import WorkflowService
from tests.conftest import postgres_reachable

pytestmark = pytest.mark.skipif(
    not postgres_reachable(),
    reason="Postgres unreachable; run `docker compose up postgres -d`",
)


def _build_test_service(bus: WorkflowEventBus) -> WorkflowService:
    """Wraps WorkflowService so its _run produces a deterministic report
    without calling any LLM or Tavily."""
    saver = MemorySaver()
    svc = WorkflowService(bus=bus, checkpointer=saver)

    async def patched_run(**kwargs: Any) -> None:
        session_id = kwargs["session_id"]
        user_id = kwargs["user_id"]
        await bus.publish(RunStarted(session_id=session_id))

        blank = ReportSection(content="—", source_ids=[])
        report = ReportContent(
            company_overview=ReportSection(content="Overview body.", source_ids=[]),
            products_and_services=blank,
            target_customers=blank,
            business_signals=blank,
            risks_and_challenges=blank,
            discovery_questions=blank,
            outreach_strategy=blank,
            unknowns=blank,
            sources=[],
        )

        sm = get_sessionmaker()
        async with sm() as db:
            row = await ReportRepository(db).upsert(
                session_id=session_id, content=report.model_dump(mode="json")
            )
            await SessionRepository(db, user_id).set_status(session_id, "completed")
            await db.commit()
            report_id = row.id
        await bus.publish(ReportReady(session_id=session_id, report_id=report_id))

    svc._run = patched_run  # type: ignore[method-assign]
    return svc


@pytest.fixture
def workflow_client():
    app = create_app()
    fake_user = CurrentUser(id="user_workflow_fixture", email="wf@example.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user
    with TestClient(app) as c:
        c.app.state.event_bus = WorkflowEventBus()
        c.app.state.workflow_service = _build_test_service(c.app.state.event_bus)
        yield c
    app.dependency_overrides.clear()


def test_run_streams_events_and_persists_report(workflow_client: TestClient) -> None:
    created = workflow_client.post(
        "/sessions",
        json={
            "company_name": "Acme",
            "website": "https://acme.example.com",
            "objective": "Workflow run integration test",
        },
    ).json()
    session_id = created["id"]

    accepted = workflow_client.post(f"/sessions/{session_id}/run")
    assert accepted.status_code == 202

    with workflow_client.stream("GET", f"/sessions/{session_id}/stream") as resp:
        assert resp.status_code == 200
        events: list[dict[str, Any]] = []
        for raw in resp.iter_lines():
            if not raw.startswith("data:"):
                continue
            events.append(json.loads(raw.removeprefix("data:").strip()))
            if events[-1]["type"] == "report_ready":
                break

    types = [e["type"] for e in events]
    assert types[0] == "run_started"
    assert types[-1] == "report_ready"

    finished = workflow_client.get(f"/sessions/{session_id}").json()
    assert finished["status"] == "completed"
    report = workflow_client.get(f"/sessions/{session_id}/report").json()
    assert report["content"]["company_overview"]["content"]


def test_starting_a_running_session_returns_409(workflow_client: TestClient) -> None:
    created = workflow_client.post(
        "/sessions",
        json={
            "company_name": "BusyCo",
            "website": "https://busy.example.com",
            "objective": "double-run rejection test",
        },
    ).json()
    session_id = created["id"]

    bus = workflow_client.app.state.event_bus
    sleeper = WorkflowService(bus=bus, checkpointer=MemorySaver())

    async def slow_run(**_: Any) -> None:
        await asyncio.sleep(10)

    sleeper._run = slow_run  # type: ignore[method-assign]
    workflow_client.app.state.workflow_service = sleeper

    first = workflow_client.post(f"/sessions/{session_id}/run")
    assert first.status_code == 202
    second = workflow_client.post(f"/sessions/{session_id}/run")
    assert second.status_code == 409


def test_stream_for_missing_session_returns_404(workflow_client: TestClient) -> None:
    r = workflow_client.get("/sessions/does-not-exist/stream")
    assert r.status_code == 404
