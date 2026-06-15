"""End-to-end POST /run + GET /stream against a fake checkpointer and mock providers.

The real AsyncPostgresSaver needs Postgres; for unit-style coverage we use the
in-memory MemorySaver. The route handlers don't care which implementation is
attached to app.state as long as the graph compiles with it.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_current_user
from app.main import create_app
from app.providers.llm.mock import MockLLMProvider
from app.providers.search.base import SearchResult
from app.providers.search.mock import MockSearchProvider
from app.services.event_bus import WorkflowEventBus
from app.services.workflow_service import WorkflowService
from app.workflow.deps import WorkflowDeps
from app.workflow.state import QualityCheck, SubQuery
from tests.conftest import postgres_reachable

pytestmark = pytest.mark.skipif(
    not postgres_reachable(),
    reason="Postgres unreachable; run `docker compose up postgres -d`",
)


def _structured_factory(_prompt: str, schema: type[BaseModel]) -> BaseModel:
    name = schema.__name__
    if "PlannerOutput" in name:
        return schema(
            subqueries=[
                SubQuery(query="overview", section="company_overview"),
                SubQuery(query="products", section="products_and_services"),
                SubQuery(query="customers", section="target_customers"),
                SubQuery(query="signals", section="business_signals"),
            ]
        )
    if "ExtractorOutput" in name:
        return schema(facts=["Fact one.", "Fact two."])
    if name == "QualityCheck":
        return QualityCheck(passed=True, reasoning="ok")
    raise AssertionError(f"unexpected schema {name}")


def _seed_search(query: str) -> list[SearchResult]:
    return [
        SearchResult(
            url=f"https://example.com/{abs(hash(query)) % 1000}",
            title=f"Page for {query}",
            snippet=f"content for {query}",
        )
    ]


def _build_test_service(bus: WorkflowEventBus) -> WorkflowService:
    """Wraps WorkflowService so it uses MemorySaver + mock providers, regardless
    of which keys are set in the environment."""
    saver = MemorySaver()
    svc = WorkflowService(bus=bus, checkpointer=saver)

    # Patch build_providers via attribute injection on the instance: override _run
    # to use deterministic mocks instead of calling the factory.
    original_run = svc._run

    async def patched_run(**kwargs: Any) -> None:
        from app.workflow.graph import build_graph

        llm = MockLLMProvider(
            text_responses=[f"section {i}" for i in range(50)],
            structured_factory=_structured_factory,
        )
        search = MockSearchProvider(responder=_seed_search)
        deps = WorkflowDeps(llm=llm, search=search, search_results_per_query=1, emit=bus.publish)

        from app.domain.events import ReportReady, RunFailed, RunStarted
        from app.persistence.db import get_sessionmaker
        from app.persistence.repositories import ReportRepository, SessionRepository

        session_id = kwargs["session_id"]
        user_id = kwargs["user_id"]
        graph = build_graph(deps, checkpointer=saver)
        await bus.publish(RunStarted(session_id=session_id))
        initial = {
            "session_id": session_id,
            "company_name": kwargs["company_name"],
            "website": kwargs["website"],
            "objective": kwargs["objective"],
            "max_attempts": 2,
            "attempt": 0,
        }
        try:
            final = await graph.ainvoke(initial, config={"configurable": {"thread_id": session_id}})
        except Exception as exc:  # noqa: BLE001
            sm = get_sessionmaker()
            async with sm() as db:
                await SessionRepository(db, user_id).set_status(session_id, "failed")
                await db.commit()
            await bus.publish(RunFailed(session_id=session_id, message=str(exc)))
            return

        report = final.get("report")
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
    del original_run
    return svc


@pytest.fixture
def workflow_client():
    """Variant of the standard client that swaps in the test workflow service."""
    app = create_app()
    fake_user = CurrentUser(id="user_workflow_fixture", email="wf@example.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user
    with TestClient(app) as c:
        # Lifespan has already created the real WorkflowService; swap it out
        # without touching the checkpointer (which the test service ignores).
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
        assert resp.headers["content-type"].startswith("text/event-stream")

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
    # Every node should have completed at least once.
    completed = {e["node"] for e in events if e["type"] == "node_completed"}
    expected_nodes = {
        "planner",
        "researcher",
        "extractor",
        "synthesizer",
        "quality_gate",
        "assembler",
    }
    assert expected_nodes <= completed

    # Session is now completed and the report is fetchable.
    finished = workflow_client.get(f"/sessions/{session_id}").json()
    assert finished["status"] == "completed"

    report = workflow_client.get(f"/sessions/{session_id}/report").json()
    assert report["content"]["company_overview"]["content"]
    assert report["content"]["sources"]


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

    # Replace the service _run with a long-sleeping no-op so the run stays in flight.
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
