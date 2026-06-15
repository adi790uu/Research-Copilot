"""End-to-end LangGraph run using only mock providers.

Verifies node wiring, conditional edge, and a complete ReportContent at the END.
No DB or checkpointer — compiles in-memory.
"""

from typing import Any

from pydantic import BaseModel

from app.providers.llm.mock import MockLLMProvider
from app.providers.search.base import SearchResult
from app.providers.search.mock import MockSearchProvider
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph
from app.workflow.state import QualityCheck, SubQuery


def _seed_search(query: str) -> list[SearchResult]:
    return [
        SearchResult(
            url=f"https://example.com/{abs(hash(query)) % 1000}",
            title=f"Page for {query}",
            snippet=f"This is content relevant to {query}. Acme makes things.",
        )
    ]


def _structured_factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
    name = schema.__name__
    if "PlannerOutput" in name:
        return schema(
            subqueries=[
                SubQuery(query="Acme overview", section="company_overview"),
                SubQuery(query="Acme products", section="products_and_services"),
                SubQuery(query="Acme customers", section="target_customers"),
                SubQuery(query="Acme funding", section="business_signals"),
            ]
        )
    if "ExtractorOutput" in name:
        # Two facts per source/section keeps the quality gate happy.
        return schema(facts=["Fact one.", "Fact two."])
    if name == "QualityCheck":
        return QualityCheck(passed=True, reasoning="all critical sections covered")
    raise AssertionError(f"Unexpected structured schema requested: {name}")


async def test_full_graph_run_produces_report() -> None:
    llm = MockLLMProvider(
        text_responses=[f"section body {i}" for i in range(50)],
        structured_factory=_structured_factory,
    )
    search = MockSearchProvider(responder=_seed_search)
    deps = WorkflowDeps(llm=llm, search=search, search_results_per_query=2)

    graph = build_graph(deps)
    initial: dict[str, Any] = {
        "session_id": "sess_1",
        "company_name": "Acme Corp",
        "website": "https://acme.example.com",
        "objective": "Evaluate as an integration partner.",
        "max_attempts": 2,
        "attempt": 0,
    }
    final = await graph.ainvoke(initial)

    report = final["report"]
    assert report is not None
    assert report.company_overview.content
    assert report.products_and_services.content
    assert report.target_customers.content
    assert report.business_signals.content
    # Sources should be deduped and present on the assembled report.
    assert len(report.sources) >= 1
    assert final.get("quality") and final["quality"].passed is True


async def test_graph_retries_when_quality_gate_fails_once() -> None:
    """Quality fails on first pass, succeeds on second — verifies the loop edge."""

    calls = {"quality": 0}

    def factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
        name = schema.__name__
        if "PlannerOutput" in name:
            return schema(
                subqueries=[SubQuery(query="Acme overview", section="company_overview")]
            )
        if "ExtractorOutput" in name:
            return schema(facts=["Fact one."])
        if name == "QualityCheck":
            calls["quality"] += 1
            if calls["quality"] == 1:
                return QualityCheck(
                    passed=False,
                    reasoning="thin",
                    missing_sections=["business_signals"],
                    refined_subqueries=[
                        SubQuery(query="Acme Series B", section="business_signals")
                    ],
                )
            return QualityCheck(passed=True, reasoning="ok after retry")
        raise AssertionError(name)

    llm = MockLLMProvider(
        text_responses=[f"body {i}" for i in range(50)],
        structured_factory=factory,
    )
    search = MockSearchProvider(responder=_seed_search)
    deps = WorkflowDeps(llm=llm, search=search, search_results_per_query=1)

    graph = build_graph(deps)
    final = await graph.ainvoke(
        {
            "session_id": "sess_2",
            "company_name": "Acme",
            "website": "https://acme.example.com",
            "objective": "Partner eval",
            "max_attempts": 3,
            "attempt": 0,
        }
    )
    assert calls["quality"] == 2
    assert final["quality"].passed is True
    assert final["report"] is not None
