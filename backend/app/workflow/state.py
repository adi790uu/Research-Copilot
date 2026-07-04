from __future__ import annotations

from langgraph.graph import MessagesState
from pydantic import BaseModel, Field


class ClarificationQuestion(BaseModel):
    question: str = Field(description="The clarification question to ask the user.")
    suggested_answers: list[str] = Field(
        default_factory=list,
        description="2-4 short suggested answers the user can tap to select.",
    )


class ClarifyWithUser(BaseModel):
    need_clarification: bool = Field(
        description="Whether the objective is too ambiguous to research without follow-up."
    )
    questions: list[ClarificationQuestion] = Field(
        default_factory=list,
        description="1-3 clarification questions. Empty when need_clarification is false.",
    )


class ResearchBrief(BaseModel):
    research_goal: str = Field(description="2-3 sentence statement of what to deliver.")
    key_entities: list[str] = Field(
        default_factory=list,
        description="People, products, competitors, or accounts the research must cover (besides the target company).",
    )
    constraints: list[str] = Field(
        default_factory=list,
        description="Only constraints the user explicitly stated.",
    )


class ResearchPlan(BaseModel):
    research_goal: str = Field(
        description="Comprehensive statement of what this research will deliver. Shown to the user for approval."
    )
    guidance: str = Field(
        description="Strategy, priorities, and boundaries for the research supervisor."
    )
    coverage_angles: list[str] = Field(
        description="Seed angles the supervisor can decompose into. Non-binding starting points, not a rigid list.",
        min_length=1,
        max_length=10,
    )


class AgentState(MessagesState):
    research_brief: str | None
    research_plan: dict | None


__all__ = [
    "AgentState",
    "ClarificationQuestion",
    "ClarifyWithUser",
    "ResearchBrief",
    "ResearchPlan",
]
