import asyncio

import pytest

from app.domain.events import NodeCompleted, NodeStarted, ReportReady, RunStarted
from app.services.event_bus import WorkflowEventBus


async def test_publish_then_subscribe_replays_log() -> None:
    bus = WorkflowEventBus()
    await bus.publish(RunStarted(session_id="s1"))
    await bus.publish(NodeStarted(session_id="s1", node="clarify_with_user", attempt=1))

    replay, queue, terminated = await bus.subscribe("s1")
    assert [e.type for e in replay] == ["run_started", "node_started"]
    assert terminated is False
    assert queue.empty()


async def test_new_events_reach_existing_subscribers() -> None:
    bus = WorkflowEventBus()
    _, queue, _ = await bus.subscribe("s2")
    await bus.publish(NodeStarted(session_id="s2", node="clarify_with_user"))
    ev = await asyncio.wait_for(queue.get(), timeout=1.0)
    assert ev is not None and ev.type == "node_started"


async def test_terminal_event_sends_sentinel_and_blocks_late_subscribers() -> None:
    bus = WorkflowEventBus()
    _, queue, _ = await bus.subscribe("s3")
    await bus.publish(NodeCompleted(session_id="s3", node="final_report_generation", duration_ms=12))
    await bus.publish(ReportReady(session_id="s3", report_id="rep_1"))

    # Live subscriber should see both events then a sentinel.
    seen: list[object] = []
    for _ in range(3):
        seen.append(await asyncio.wait_for(queue.get(), timeout=1.0))
    assert seen[-1] is None

    replay, late_queue, terminated = await bus.subscribe("s3")
    assert terminated is True
    assert [e.type for e in replay] == ["node_completed", "report_ready"]
    # The sentinel is queued so a generator on the late subscriber exits immediately.
    assert await asyncio.wait_for(late_queue.get(), timeout=1.0) is None


async def test_reset_drops_retained_events() -> None:
    bus = WorkflowEventBus()
    await bus.publish(RunStarted(session_id="s4"))
    await bus.reset("s4")
    replay, _, _ = await bus.subscribe("s4")
    assert replay == []


async def test_unsubscribe_removes_queue() -> None:
    bus = WorkflowEventBus()
    _, queue, _ = await bus.subscribe("s5")
    await bus.unsubscribe("s5", queue)
    await bus.publish(NodeStarted(session_id="s5", node="clarify_with_user"))
    # The unsubscribed queue should not receive the new event.
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue.get(), timeout=0.1)
