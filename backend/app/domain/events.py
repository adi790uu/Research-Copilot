"""Typed events emitted while a research run is in flight.

Streamed over SSE to the frontend so the UI can show per-node progress, ask
the user to answer clarification questions, approve the plan, and flip into
report mode the moment the run finishes.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

# Node names used in the LangGraph workflow. Kept here (not in workflow/) so the
# frontend type model can mirror this list without pulling in workflow internals.
NodeName = Literal[
    "clarify_with_user",
    "write_research_brief",
    "create_research_plan",
    "research_supervisor",
    "final_report_generation",
]


class _BaseEvent(BaseModel):
    session_id: str
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


class NodeFailed(_BaseEvent):
    type: Literal["node_failed"] = "node_failed"
    node: NodeName
    attempt: int = 1
    message: str


class ClarificationRequested(_BaseEvent):
    """Graph terminated at clarify_with_user; service awaits user answers."""

    type: Literal["clarification_requested"] = "clarification_requested"
    questions: list[dict[str, Any]]  # [{question, suggested_answers: [...]}, ...]


class PlanReady(_BaseEvent):
    """Graph hit interrupt_after=[create_research_plan]; service awaits approval."""

    type: Literal["plan_ready"] = "plan_ready"
    plan: dict[str, Any]  # serialized ResearchPlan


class ReportReady(_BaseEvent):
    type: Literal["report_ready"] = "report_ready"
    report_id: str


class RunFailed(_BaseEvent):
    type: Literal["run_failed"] = "run_failed"
    message: str


WorkflowEvent = Annotated[
    RunStarted
    | NodeStarted
    | NodeCompleted
    | NodeFailed
    | ClarificationRequested
    | PlanReady
    | ReportReady
    | RunFailed,
    Field(discriminator="type"),
]


TERMINAL_EVENT_TYPES = frozenset({"report_ready", "run_failed", "clarification_requested"})
