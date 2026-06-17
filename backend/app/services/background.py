"""Background research job runner.

Drives the LangGraph from `interrupt_after=[create_research_plan]` through
the supervisor + final_report nodes. Owns the **job-lifecycle** persistence
only:

  - Flip `research_jobs.status` (`running` → `completed` / `failed`).
  - Append a JSON-safe slice of every non-final node update to
    `research_job_events` for polling visibility.
  - JSON-dump the `ReportContent` from `final_report_generation` into
    `research_jobs.final_report`, plus the deduped sources list.

Per-researcher rows + `research_tasks` lifecycle are written by
`workflow/nodes/supervisor.py` directly (mirrors research-assistant's
pattern). That node holds the tool_call args and the subgraph result
without indirection, so the persistence sits closest to the data.

This function never raises — failures are logged and the job is marked
`failed` on the DB row.
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
from typing import Any

from app.services import job_store

logger = logging.getLogger(__name__)

# Hard cap so a runaway researcher loop can't park a Task forever.
_JOB_TIMEOUT_SECONDS = 1800  # 30 minutes


def _to_dict(obj: Any) -> Any:
    try:
        from pydantic import BaseModel

        if isinstance(obj, BaseModel):
            return obj.model_dump(mode="json")
    except ImportError:
        pass
    if isinstance(obj, list):
        return [_to_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    inner = getattr(obj, "__dict__", None)
    if isinstance(inner, dict):
        return {k: _to_dict(v) for k, v in inner.items() if not k.startswith("_")}
    return str(obj)


async def _fail_running_tasks(job_id: str) -> None:
    try:
        await job_store.fail_running_tasks(job_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("could not fail running tasks for job %s: %s", job_id, e)


async def _fail_job(job_id: str, error_message: str) -> None:
    try:
        await job_store.update_job_status(job_id, "failed")
        await job_store.append_job_event(job_id, "error", {"message": error_message})
        await _fail_running_tasks(job_id)
    except Exception as e:  # noqa: BLE001
        logger.error("could not persist failure for job %s: %s", job_id, e)


async def _persist_node_event(job_id: str, node_key: str, node_update: dict) -> None:
    """Persist a flat, JSON-safe slice of a node update so polling can show it."""
    safe = {
        k: v
        for k, v in node_update.items()
        if isinstance(v, (str, int, float, bool, list, dict, type(None)))
        and k
        not in (
            "messages",
            "supervisor_messages",
            "researcher_messages",
            # raw_notes / notes are bulky and not useful for the UI poll
            "raw_notes",
            "notes",
        )
    }
    if safe:
        try:
            await job_store.append_job_event(job_id, node_key, _to_dict(safe))
        except Exception as e:  # noqa: BLE001
            logger.debug("skipping event for node %s: %s", node_key, e)


async def _run_graph_stream(job_id: str, graph: Any, config: dict) -> None:
    await job_store.update_job_status(job_id, "running")

    sources_acc: list[dict] = []
    report_payload: dict | None = None

    async for stream_data in graph.astream(None, config, stream_mode="updates"):
        if not isinstance(stream_data, dict):
            continue

        for node_key, node_update in stream_data.items():
            if not isinstance(node_update, dict):
                continue

            # Aggregate sources off the supervisor's update dict. The
            # supervisor merges per-researcher sources into a single list
            # here; per-researcher attribution lives in
            # research_job_researchers (written by the supervisor itself).
            new_sources = node_update.get("sources")
            if isinstance(new_sources, list):
                for s in new_sources:
                    sources_acc.append(_to_dict(s))

            if node_key == "final_report_generation":
                # `final_report_generation` returns `{"report": ReportContent}`.
                # JSON-dump it for the Text column.
                report = node_update.get("report")
                if report is not None:
                    report_payload = _to_dict(report)
            else:
                # Persist a JSON-safe slice of this update as a job event.
                await _persist_node_event(job_id, node_key, node_update)

    if not report_payload:
        raise RuntimeError("Graph stream ended without producing a final report")

    # Deduplicate sources by URL while preserving order.
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for s in sources_acc:
        url = s.get("url") if isinstance(s, dict) else None
        if not isinstance(url, str):
            deduped.append(s)
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        deduped.append(s)

    await job_store.update_job_result(
        job_id, final_report=_json.dumps(report_payload), sources=deduped
    )


async def run_background_job(job_id: str, graph: Any, config: dict) -> None:
    """Resume the graph from checkpoint and persist progress.

    Never raises — failures are logged and the job is marked failed in the DB.
    """
    try:
        await asyncio.wait_for(
            _run_graph_stream(job_id, graph, config),
            timeout=_JOB_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error("background job %s timed out", job_id)
        await _fail_job(job_id, f"Research timed out after {_JOB_TIMEOUT_SECONDS // 60} minutes")
    except Exception as e:  # noqa: BLE001
        logger.error("background job %s failed: %s", job_id, e, exc_info=True)
        await _fail_job(job_id, str(e))
