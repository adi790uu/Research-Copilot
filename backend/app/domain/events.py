"""Typed events emitted while a research run is in flight.

Streamed over SSE during phase 1 (clarify → brief → plan). Phase 2 (the
background research job) persists progress to the DB via `job_store`
instead — the frontend polls the job row, not this event stream.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

# Node names used in the LangGraph workflow. Kept here (not in workflow/) so the
# frontend type model can mirror this list without pulling in workflow internals.
# Only Graph 1 nodes are emitted; phase 2 runs in the external worker.
NodeName = Literal[
    "clarify_with_user",
    "write_research_brief",
    "create_research_plan",
]


class _BaseEvent(BaseModel):
    brief_id: str
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class RunStarted(_BaseEvent):
    type: Literal["run_started"] = "run_started"


class NodeStarted(_BaseEvent):
    type: Literal["node_started"] = "node_started"
    node: NodeName
    attempt: int = 1


class NodeCompleted(_BaseEvent):
    type: Literal["node_completed"] = "node_completed"
    node: NodeName
    attempt: int = 1
    duration_ms: int


class ClarificationRequested(_BaseEvent):
    """Graph terminated at clarify_with_user; service awaits user answers."""

    type: Literal["clarification_requested"] = "clarification_requested"
    questions: list[dict[str, Any]]  # [{question, suggested_answers: [...]}, ...]


class PlanReady(_BaseEvent):
    """Graph 1 finished — the research plan is ready for review.

    The SSE stream closes after this event. The frontend lets the user
    edit/approve the plan, then calls `POST /sessions/{id}/plan/approve`
    which creates the job and triggers the worker. `job_id` is therefore
    not known yet at this point (the approve call returns it).
    """

    type: Literal["plan_ready"] = "plan_ready"
    plan: dict[str, Any]  # serialized ResearchPlan
    job_id: str | None = None


class RunFailed(_BaseEvent):
    type: Literal["run_failed"] = "run_failed"
    message: str


WorkflowEvent = Annotated[
    RunStarted
    | NodeStarted
    | NodeCompleted
    | ClarificationRequested
    | PlanReady
    | RunFailed,
    Field(discriminator="type"),
]
