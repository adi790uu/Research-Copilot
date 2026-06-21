"""Workflow smoke runner.

Usage:
    python -m app.workflow.smoke "Acme Corp" \\
        --website https://acme.example.com \\
        --objective "Evaluate as integration partner"

Drives Graph 1 (clarify → brief → plan) end-to-end. The model is read from
config (`OPENAI_API_KEY` / `OPENAI_MODEL`); with no key set the ChatOpenAI
calls will fail, so point it at a real key or a local Models endpoint.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.workflow.graph import build_graph


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    # In-memory checkpointer so the run can resume past the plan interrupt.
    graph = build_graph(checkpointer=MemorySaver())

    config = {
        "configurable": {
            "thread_id": "smoke",
            "company_name": args.company,
            "website": args.website,
            # Disable clarification for smoke runs so we always reach the plan.
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
    }

    final = await graph.ainvoke(initial, config=config)

    return {
        "company": args.company,
        "research_plan": final.get("research_plan"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the company-research Graph 1 end-to-end.")
    parser.add_argument("company", help="Company name")
    parser.add_argument("--website", default="https://example.com", help="Company website")
    parser.add_argument(
        "--objective",
        default="Evaluate as a potential customer or integration partner.",
        help="Seller objective for the run",
    )
    args = parser.parse_args()
    result = asyncio.run(_run(args))
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
