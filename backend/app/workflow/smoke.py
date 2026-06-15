"""Workflow smoke runner.

Usage:
    python -m app.workflow.smoke "Acme Corp" \\
        --website https://acme.example.com \\
        --objective "Evaluate as integration partner"

By default uses mock LLM + search providers so it runs offline. Pass
`--real` to use OpenAI + Tavily (requires OPENAI_API_KEY and TAVILY_API_KEY).
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from pydantic import BaseModel

from app.core.config import get_settings
from app.providers.llm.base import LLMProvider
from app.providers.llm.mock import MockLLMProvider
from app.providers.llm.openai import OpenAIProvider
from app.providers.search.base import SearchProvider, SearchResult
from app.providers.search.mock import MockSearchProvider
from app.providers.search.tavily import TavilySearchProvider
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph
from app.workflow.state import QualityCheck, SubQuery


def _mock_providers(company: str) -> tuple[LLMProvider, SearchProvider]:
    def search_responder(query: str) -> list[SearchResult]:
        return [
            SearchResult(
                url=f"https://example.com/{abs(hash(query)) % 10000}",
                title=f"Mock page for: {query}",
                snippet=(
                    f"This is mock content for '{query}'. {company} is a fictional "
                    "company used for offline smoke runs. It builds widgets, has "
                    "global customers, raised funding last year, and faces competition."
                ),
            )
        ]

    def llm_factory(prompt: str, schema: type[BaseModel]) -> BaseModel:
        name = schema.__name__
        if "PlannerOutput" in name:
            return schema(
                subqueries=[
                    SubQuery(query=f"{company} overview", section="company_overview"),
                    SubQuery(query=f"{company} products", section="products_and_services"),
                    SubQuery(query=f"{company} customers", section="target_customers"),
                    SubQuery(query=f"{company} funding", section="business_signals"),
                ]
            )
        if "ExtractorOutput" in name:
            return schema(facts=[f"{company} fact A.", f"{company} fact B."])
        if name == "QualityCheck":
            return QualityCheck(passed=True, reasoning="mock — all sections covered")
        raise AssertionError(f"unexpected schema {name}")

    text_responses = [f"This is the drafted section content #{i}." for i in range(50)]
    return (
        MockLLMProvider(text_responses=text_responses, structured_factory=llm_factory),
        MockSearchProvider(responder=search_responder),
    )


def _real_providers() -> tuple[LLMProvider, SearchProvider]:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY required for --real")
    if not settings.tavily_api_key:
        raise RuntimeError("TAVILY_API_KEY required for --real")
    return (
        OpenAIProvider(settings.openai_api_key, settings.openai_model),
        TavilySearchProvider(settings.tavily_api_key),
    )


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.real:
        llm, search = _real_providers()
    else:
        llm, search = _mock_providers(args.company)

    deps = WorkflowDeps(
        llm=llm,
        search=search,
        search_results_per_query=get_settings().workflow_search_results_per_query,
    )
    graph = build_graph(deps)
    initial: dict[str, Any] = {
        "session_id": "smoke",
        "company_name": args.company,
        "website": args.website,
        "objective": args.objective,
        "max_attempts": get_settings().workflow_max_attempts,
        "attempt": 0,
    }
    final = await graph.ainvoke(initial)
    report = final["report"]
    return {
        "company": args.company,
        "quality": final["quality"].model_dump() if final.get("quality") else None,
        "errors": [e.model_dump() for e in final.get("errors", [])],
        "report": report.model_dump() if report else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the research workflow end-to-end.")
    parser.add_argument("company", help="Company name")
    parser.add_argument("--website", default="https://example.com", help="Company website")
    parser.add_argument(
        "--objective",
        default="Evaluate as a potential customer or integration partner.",
        help="Seller objective for the run",
    )
    parser.add_argument(
        "--real",
        action="store_true",
        help="Use real OpenAI + Tavily providers (requires keys)",
    )
    args = parser.parse_args()
    result = asyncio.run(_run(args))
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
