from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

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
    type: Literal["clarification_requested"] = "clarification_requested"
    questions: list[dict[str, Any]]


class PlanReady(_BaseEvent):
    type: Literal["plan_ready"] = "plan_ready"
    plan: dict[str, Any]
    job_id: str | None = None


class RunFailed(_BaseEvent):
    type: Literal["run_failed"] = "run_failed"
    message: str


WorkflowEvent = Annotated[
    RunStarted | NodeStarted | NodeCompleted | ClarificationRequested | PlanReady | RunFailed,
    Field(discriminator="type"),
]
