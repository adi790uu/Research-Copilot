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

from langchain_core.messages import HumanMessage

from app.core.config import get_settings
from app.providers.factory import build_providers
from app.providers.llm.base import LLMProvider
from app.providers.llm.openai import OpenAIProvider
from app.providers.search.base import SearchProvider
from app.providers.search.tavily import TavilySearchProvider
from app.workflow.deps import WorkflowDeps
from app.workflow.graph import build_graph


def _real_providers() -> tuple[LLMProvider, SearchProvider]:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY required for --real")
    if not settings.tavily_api_key:
        raise RuntimeError("TAVILY_API_KEY required for --real")
    return (
        OpenAIProvider(
            settings.openai_api_key,
            settings.openai_model,
            base_url=settings.openai_base_url or None,
        ),
        TavilySearchProvider(settings.tavily_api_key),
    )


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    settings = get_settings()
    if args.real:
        llm, search = _real_providers()
    else:
        llm, search = build_providers(settings, company_hint=args.company)

    deps = WorkflowDeps(llm=llm, search=search)
    graph = build_graph(deps)

    config = {
        "configurable": {
            "thread_id": "smoke",
            "search_provider": search,
            "company_name": args.company,
            "website": args.website,
            # Disable clarification for smoke runs so we always reach the report.
            "allow_clarification": False,
        }
    }

    seed_text = (
        f"Company: {args.company}\nWebsite: {args.website}\nObjective: {args.objective}"
    )
    initial = {
        "messages": [HumanMessage(content=seed_text)],
        "session_id": "smoke",
        "company_name": args.company,
        "website": args.website,
        "objective": args.objective,
        "supervisor_messages": {"type": "override", "value": []},
        "notes": {"type": "override", "value": []},
        "raw_notes": {"type": "override", "value": []},
    }

    # Drive past the create_research_plan interrupt automatically.
    await graph.ainvoke(initial, config=config)
    final = await graph.ainvoke(None, config=config)

    report = final.get("report")
    return {
        "company": args.company,
        "report": report.model_dump(mode="json") if report else None,
        "sources_count": len(final.get("sources", []) or []),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the company-research workflow end-to-end.")
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
