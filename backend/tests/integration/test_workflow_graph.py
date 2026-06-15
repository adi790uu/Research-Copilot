"""End-to-end LangGraph run for the company-research workflow using a patched
chat model. Verifies node wiring, the create_research_plan interrupt, and a
complete ReportContent at the end.

No DB or checkpointer — compiles in-memory.
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.domain.report import ReportContent, ReportSection
from app.providers.llm.mock import MockLLMProvider
from app.providers.search.base import SearchResult
from app.providers.search.mock import MockSearchProvider
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph
from app.workflow.state import (
    ClarifyWithUser,
    ResearchBrief,
    ResearchPlan,
    ResearchSubtopic,
)


class _FakeModel:
    """A multi-mode fake that returns whatever the current node needs."""

    def __init__(self) -> None:
        self._structured_schema: type[Any] | None = None
        self._bound = False

    def with_structured_output(self, schema: type[Any]) -> _FakeModel:
        clone = _FakeModel()
        clone._structured_schema = schema
        return clone

    def bind_tools(self, _tools: list[Any]) -> _FakeModel:
        clone = _FakeModel()
        clone._bound = True
        return clone

    def with_retry(self, **_kwargs: Any) -> _FakeModel:
        return self

    async def ainvoke(self, _messages: Any, *_a: Any, **_kw: Any) -> Any:
        schema = self._structured_schema
        if schema is ClarifyWithUser:
            return ClarifyWithUser(need_clarification=False, questions=[])
        if schema is ResearchBrief:
            return ResearchBrief(
                research_goal="Evaluate Acme as a partner.",
                key_entities=["Acme"],
                constraints=[],
                source_strategy="company_site_first",
            )
        if schema is ResearchPlan:
            return ResearchPlan(
                user_message="I'll research Acme overview and signals.",
                strategy_summary="Cover overview, products, customers, signals.",
                subtopics=[
                    ResearchSubtopic(
                        title="Overview",
                        description="Who Acme is.",
                        section="company_overview",
                        tools="company_site",
                        priority="depth",
                    ),
                ],
            )
        if schema is ReportContent:
            blank = ReportSection(content="See findings.", source_ids=[])
            return ReportContent(
                company_overview=ReportSection(
                    content="Acme makes widgets [src_aaaa].", source_ids=["src_aaaa"]
                ),
                products_and_services=blank,
                target_customers=blank,
                business_signals=blank,
                risks_and_challenges=blank,
                discovery_questions=blank,
                outreach_strategy=blank,
                unknowns=blank,
                sources=[],
            )
        # Polished section pass for any section.
        from app.workflow.state import _PolishedSection

        if schema is _PolishedSection:
            return _PolishedSection(content="polished content", source_ids=[])
        if self._bound:
            # Supervisor LLM call — answer with ResearchComplete immediately so the
            # supervisor subgraph terminates without dispatching researchers.
            return AIMessage(
                content="",
                tool_calls=[{"id": "tc1", "name": "ResearchComplete", "args": {}}],
            )
        return AIMessage(content="compressed")


@pytest.fixture(autouse=True)
def _patch_create_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch _create_model in every module that imports it."""
    from app.workflow.nodes import (
        clarify,
        final_report,
        research_brief,
        research_plan,
        researcher,
        supervisor,
    )

    for mod in (clarify, research_brief, research_plan, supervisor, researcher, final_report):
        monkeypatch.setattr(mod, "_create_model", lambda **_: _FakeModel())


def _seed_search(query: str) -> list[SearchResult]:
    return [
        SearchResult(
            url=f"https://acme.example.com/{abs(hash(query)) % 1000}",
            title="About",
            snippet=f"snippet for {query}",
            content=f"Acme content for {query}.",
        )
    ]


async def test_full_graph_run_produces_report() -> None:
    llm = MockLLMProvider(text_responses=["compressed" for _ in range(50)])
    search = MockSearchProvider(responder=_seed_search)
    deps = WorkflowDeps(llm=llm, search=search)

    graph = build_graph(deps, checkpointer=MemorySaver())
    config = {
        "configurable": {
            "thread_id": "sess_smoke",
            "search_provider": search,
            "company_name": "Acme",
            "website": "https://acme.example.com",
            "allow_clarification": False,
        }
    }

    initial: dict[str, Any] = {
        "messages": [HumanMessage(content="Company: Acme\nWebsite: https://acme.example.com\nObjective: eval")],
        "session_id": "sess_smoke",
        "company_name": "Acme",
        "website": "https://acme.example.com",
        "objective": "eval",
        "supervisor_messages": {"type": "override", "value": []},
        "notes": {"type": "override", "value": []},
        "raw_notes": {"type": "override", "value": []},
    }

    # Drive past the create_research_plan interrupt.
    await graph.ainvoke(initial, config=config)
    final = await graph.ainvoke(None, config=config)

    report = final.get("report")
    assert report is not None
    assert isinstance(report, ReportContent)
    assert report.company_overview.content
