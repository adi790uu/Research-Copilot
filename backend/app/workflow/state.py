import operator
from typing import Annotated, TypedDict

from pydantic import BaseModel, Field

from app.domain.report import ReportContent, Source


class SubQuery(BaseModel):
    """One unit of research the planner emits, scoped to a report section."""

    query: str
    section: str  # one of ReportContent field names (or "general")


class Fact(BaseModel):
    """Extracted, citation-bearing claim used downstream by the synthesizer."""

    text: str
    source_id: str
    section: str  # target ReportContent field


class QualityCheck(BaseModel):
    passed: bool
    reasoning: str
    missing_sections: list[str] = Field(default_factory=list)
    refined_subqueries: list[SubQuery] = Field(default_factory=list)


class NodeError(BaseModel):
    node: str
    message: str


def _dedup_sources(left: list[Source], right: list[Source]) -> list[Source]:
    seen: dict[str, Source] = {s.url: s for s in left}
    for s in right:
        seen.setdefault(s.url, s)
    return list(seen.values())


def _merge_subqueries(
    left: list[SubQuery], right: list[SubQuery]
) -> list[SubQuery]:
    """Quality gate emits a refined subquery list to replace the previous one."""
    return right if right else left


class GraphState(TypedDict, total=False):
    session_id: str
    company_name: str
    website: str
    objective: str

    subqueries: Annotated[list[SubQuery], _merge_subqueries]
    sources: Annotated[list[Source], _dedup_sources]
    facts: Annotated[list[Fact], operator.add]

    sections_drafted: bool
    quality: QualityCheck | None
    attempt: int
    max_attempts: int

    errors: Annotated[list[NodeError], operator.add]
    report: ReportContent | None
