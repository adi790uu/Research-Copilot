"""LangGraph state + structured outputs for the company-research workflow."""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import MessageLikeRepresentation
from langgraph.graph import MessagesState
from pydantic import BaseModel, Field

from app.domain.report import ReportContent, Source

# ----- Reducers ----------------------------------------------------------

SourceStrategy = Literal["company_site_first", "external_first", "both_parallel"]
ToolsRouting = Literal["company_site", "web", "both"]
Priority = Literal["depth", "breadth"]

# Keys MUST stay in sync with `app.domain.report.ReportContent`. Used by
# the reviewer prompt to iterate per-section and by the prompts module to
# expose a stable catalog string.
ReportSectionName = Literal[
    "company_overview",
    "products_and_services",
    "target_customers",
    "business_signals",
    "risks_and_challenges",
    "discovery_questions",
    "outreach_strategy",
    "unknowns",
]


def override_reducer(current: list[Any], new: Any) -> list[Any]:
    """Append-by-default reducer; sentinel `{"type": "override", "value": [...]}` replaces."""
    if isinstance(new, dict) and new.get("type") == "override":
        value = new.get("value", [])
        return list(value) if isinstance(value, list) else [value]
    return list(operator.add(current or [], new or []))


def _dedup_sources(left: list[Source], right: list[Source]) -> list[Source]:
    seen: dict[str, Source] = {s.url: s for s in (left or [])}
    for s in right or []:
        seen.setdefault(s.url, s)
    return list(seen.values())


# ----- Structured outputs ------------------------------------------------


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
    source_strategy: SourceStrategy = Field(
        description="company_site_first (default), external_first, or both_parallel."
    )


class ResearchSubtopic(BaseModel):
    title: str = Field(description="Short name for this subtopic.")
    description: str = Field(description="1-2 sentences on what to investigate.")
    tools: ToolsRouting = Field(
        description="company_site, web, or both.",
    )
    priority: Priority = Field(description="depth or breadth.")


class ResearchPlan(BaseModel):
    user_message: str = Field(
        description="2-3 sentence first-person note to the user about the planned research."
    )
    strategy_summary: str = Field(description="1-2 sentence internal note on overall strategy.")
    subtopics: list[ResearchSubtopic] = Field(
        description="Ordered list; each becomes one parallel researcher.",
        min_length=1,
        max_length=8,
    )


class ConductResearch(BaseModel):
    """Delegate one research task to a sub-agent. Each call spawns an independent researcher."""

    research_topic: str = Field(
        description=(
            "Detailed, standalone research instructions. Must name the company, "
            "the angle, and what good output looks like."
        )
    )
    tools_to_use: ToolsRouting = Field(
        description="company_site | web | both.",
    )


class ResearchComplete(BaseModel):
    """Call when research is sufficient to write the final report."""


class _PolishedSection(BaseModel):
    """Pass-2 review output for a single section. Used by `final_report.py`."""

    content: str
    source_ids: list[str] = Field(default_factory=list)


# ----- LangGraph states --------------------------------------------------


class AgentState(MessagesState):
    """Top-level state for the company-research graph.

    `research_plan` is stored as a plain dict (the `ResearchPlan.model_dump`
    output) rather than the Pydantic instance — LangGraph's msgpack
    serializer warns on unregistered types, and a dict round-trips through
    the checkpointer cleanly. The plan node fills this with
    `plan.model_dump(mode="json")`; consumers can `ResearchPlan.model_validate`
    if they need typed access.
    """

    session_id: str
    company_name: str
    website: str
    objective: str

    supervisor_messages: Annotated[list[MessageLikeRepresentation], override_reducer]
    research_brief: str | None
    research_plan: dict | None
    notes: Annotated[list[str], override_reducer]
    raw_notes: Annotated[list[str], override_reducer]
    sources: Annotated[list[Source], _dedup_sources]
    # Structured 8-section report produced by `final_report_generation`.
    # The model_dump'd shape lands in `research_jobs.final_report` as JSON
    # so the frontend can render the same structure it sees here.
    report: ReportContent | None


class SupervisorState(TypedDict, total=False):
    company_name: str
    website: str
    supervisor_messages: Annotated[list[MessageLikeRepresentation], override_reducer]
    research_brief: str
    notes: Annotated[list[str], override_reducer]
    raw_notes: Annotated[list[str], override_reducer]
    sources: Annotated[list[Source], _dedup_sources]
    research_iterations: int


class ResearcherState(TypedDict, total=False):
    researcher_messages: Annotated[list[MessageLikeRepresentation], operator.add]
    research_topic: str
    tools_to_use: ToolsRouting
    company_name: str
    website: str
    tool_call_iterations: int
    compressed_research: str
    raw_notes: list[str]
    sources: list[Source]


__all__ = [
    "AgentState",
    "ClarificationQuestion",
    "ClarifyWithUser",
    "ConductResearch",
    "Priority",
    "ReportSectionName",
    "ResearchBrief",
    "ResearchComplete",
    "ResearcherState",
    "ResearchPlan",
    "ResearchSubtopic",
    "Source",
    "SourceStrategy",
    "SupervisorState",
    "ToolsRouting",
    "_PolishedSection",
    "override_reducer",
]
