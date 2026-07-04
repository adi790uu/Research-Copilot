from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.workflow.graph import build_graph


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    graph = build_graph(checkpointer=MemorySaver())

    config = {
        "configurable": {
            "thread_id": "smoke",
            "allow_clarification": False,
        }
    }

    seed_text = (
        f"Company Name: {args.company}\nWebsite: {args.website}\nObjective: {args.objective}"
    )
    initial = {"messages": [HumanMessage(content=seed_text)]}

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
