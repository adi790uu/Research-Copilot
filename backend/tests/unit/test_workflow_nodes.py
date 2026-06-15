from typing import Any

import pytest
from pydantic import BaseModel

from app.domain.report import Source
from app.providers.llm.mock import MockLLMProvider
from app.providers.search.base import SearchResult
from app.providers.search.mock import MockSearchProvider
from app.workflow.deps import WorkflowDeps
from app.workflow.nodes.assembler import assembler
from app.workflow.nodes.extractor import extractor
from app.workflow.nodes.planner import planner
from app.workflow.nodes.quality_gate import quality_gate
from app.workflow.nodes.researcher import researcher
from app.workflow.nodes.synthesizer import synthesizer
from app.workflow.state import Fact, GraphState, QualityCheck, SubQuery


def _state(**over: Any) -> GraphState:
    base: GraphState = {
        "session_id": "sess_1",
        "company_name": "Acme Corp",
        "website": "https://acme.example.com",
        "objective": "Evaluate as integration partner",
        "max_attempts": 2,
    }
    base.update(over)  # type: ignore[typeddict-item]
    return base


# ---------------------------------------------------------------------------
# planner
# ---------------------------------------------------------------------------

async def test_planner_returns_subqueries_and_increments_attempt() -> None:
    def factory(_prompt: str, schema: type[BaseModel]) -> BaseModel:
        return schema(
            subqueries=[
                SubQuery(query="Acme funding rounds", section="business_signals"),
                SubQuery(query="Acme products overview", section="products_and_services"),
            ]
        )

    deps = WorkflowDeps(
        llm=MockLLMProvider(structured_factory=factory),
        search=MockSearchProvider(),
    )
    out = await planner(_state(), deps)
    assert len(out["subqueries"]) == 2
    assert out["attempt"] == 1


async def test_planner_swallows_llm_error_and_records() -> None:
    def boom(_p: str, _s: type[BaseModel]) -> BaseModel:
        raise RuntimeError("llm down")

    deps = WorkflowDeps(llm=MockLLMProvider(structured_factory=boom), search=MockSearchProvider())
    out = await planner(_state(), deps)
    assert out["subqueries"] == []
    assert out["errors"][0].node == "planner"
    assert out["attempt"] == 1


# ---------------------------------------------------------------------------
# researcher
# ---------------------------------------------------------------------------

async def test_researcher_dedups_by_url() -> None:
    shared = SearchResult(url="https://x.example/a", title="A", snippet="snip")
    other = SearchResult(url="https://x.example/b", title="B", snippet="snip")

    def responder(q: str) -> list[SearchResult]:
        return [shared, other] if "funding" in q else [shared]

    deps = WorkflowDeps(
        llm=MockLLMProvider(),
        search=MockSearchProvider(responder=responder),
        search_results_per_query=5,
    )
    state = _state(
        subqueries=[
            SubQuery(query="Acme funding", section="business_signals"),
            SubQuery(query="Acme products", section="products_and_services"),
        ]
    )
    out = await researcher(state, deps)
    urls = sorted(s.url for s in out["sources"])
    assert urls == ["https://x.example/a", "https://x.example/b"]


async def test_researcher_no_subqueries_returns_empty() -> None:
    deps = WorkflowDeps(llm=MockLLMProvider(), search=MockSearchProvider())
    out = await researcher(_state(subqueries=[]), deps)
    assert out["sources"] == []


# ---------------------------------------------------------------------------
# extractor
# ---------------------------------------------------------------------------

async def test_extractor_emits_facts_per_section() -> None:
    sources = [
        Source(id="src_aaaa", url="https://x/a", title="A", snippet="Acme raised $50M."),
    ]
    subqueries = [
        SubQuery(query="Acme funding", section="business_signals"),
        SubQuery(query="Acme customers", section="target_customers"),
    ]

    def factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
        # Return one fact per call, mentioning the section name so we can verify.
        section = "business_signals" if "business_signals" in prompt else "target_customers"
        return schema(facts=[f"Fact for {section}"])

    deps = WorkflowDeps(
        llm=MockLLMProvider(structured_factory=factory),
        search=MockSearchProvider(),
    )
    out = await extractor(_state(sources=sources, subqueries=subqueries), deps)
    sections = {f.section for f in out["facts"]}
    assert sections == {"business_signals", "target_customers"}
    assert all(f.source_id == "src_aaaa" for f in out["facts"])


# ---------------------------------------------------------------------------
# synthesizer
# ---------------------------------------------------------------------------

async def test_synthesizer_builds_report_with_all_sections() -> None:
    facts = [
        Fact(text="Acme makes widgets.", source_id="src_aaa", section="company_overview"),
        Fact(text="Acme has global ops.", source_id="src_aaa", section="company_overview"),
        Fact(text="Acme sells SaaS.", source_id="src_aaa", section="products_and_services"),
        Fact(text="Acme has SMB customers.", source_id="src_bbb", section="target_customers"),
        Fact(text="Acme raised Series B.", source_id="src_bbb", section="business_signals"),
    ]
    sources = [
        Source(id="src_aaa", url="https://x/1", title="One", snippet="..."),
        Source(id="src_bbb", url="https://x/2", title="Two", snippet="..."),
    ]
    text_responses = [f"draft body {i}" for i in range(100)]  # plenty
    deps = WorkflowDeps(
        llm=MockLLMProvider(text_responses=text_responses),
        search=MockSearchProvider(),
    )
    out = await synthesizer(_state(facts=facts, sources=sources), deps)
    report = out["report"]
    assert report is not None
    assert report.company_overview.content.startswith("draft body")
    assert "src_aaa" in report.company_overview.source_ids
    assert report.sources == sources
    assert out["sections_drafted"] is True


# ---------------------------------------------------------------------------
# quality gate
# ---------------------------------------------------------------------------

async def test_quality_gate_passes_when_all_critical_have_facts() -> None:
    facts = [
        Fact(text="f", source_id="s", section=sec)
        for sec in ("company_overview", "products_and_services", "target_customers", "business_signals")
        for _ in range(2)
    ]
    deps = WorkflowDeps(llm=MockLLMProvider(), search=MockSearchProvider())
    out = await quality_gate(_state(facts=facts, attempt=1), deps)
    assert out["quality"].passed is True


async def test_quality_gate_forces_pass_at_max_attempts() -> None:
    deps = WorkflowDeps(llm=MockLLMProvider(), search=MockSearchProvider())
    # No facts, but attempt == max_attempts so we accept anyway.
    out = await quality_gate(_state(facts=[], attempt=2, max_attempts=2), deps)
    assert out["quality"].passed is True
    assert "max attempts" in out["quality"].reasoning.lower()


async def test_quality_gate_emits_refined_subqueries_on_thin_draft() -> None:
    refined = [SubQuery(query="Sharper Acme funding", section="business_signals")]

    def factory(_p: str, schema: type[BaseModel]) -> BaseModel:
        return schema(
            passed=False,
            reasoning="thin",
            missing_sections=["business_signals"],
            refined_subqueries=refined,
        )

    deps = WorkflowDeps(
        llm=MockLLMProvider(structured_factory=factory),
        search=MockSearchProvider(),
    )
    out = await quality_gate(_state(facts=[], attempt=1, max_attempts=2), deps)
    assert out["quality"].passed is False
    assert out["subqueries"] == refined
    assert out["attempt"] == 2


# ---------------------------------------------------------------------------
# assembler
# ---------------------------------------------------------------------------

async def test_assembler_refreshes_sources_on_report() -> None:
    from app.domain.report import ReportContent, ReportSection

    blank = ReportSection(content="", source_ids=[])
    report = ReportContent(
        company_overview=blank,
        products_and_services=blank,
        target_customers=blank,
        business_signals=blank,
        risks_and_challenges=blank,
        discovery_questions=blank,
        outreach_strategy=blank,
        unknowns=blank,
        sources=[],
    )
    new_sources = [Source(id="src_a", url="https://x/1", title="t", snippet="s")]
    deps = WorkflowDeps(llm=MockLLMProvider(), search=MockSearchProvider())
    out = await assembler(_state(report=report, sources=new_sources), deps)
    assert out["report"].sources == new_sources


async def test_assembler_noop_without_report() -> None:
    deps = WorkflowDeps(llm=MockLLMProvider(), search=MockSearchProvider())
    out = await assembler(_state(), deps)
    assert out == {}
