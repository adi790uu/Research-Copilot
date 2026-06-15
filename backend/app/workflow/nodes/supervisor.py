"""Supervisor subgraph.

Dispatches ConductResearch calls in parallel (up to a cap) and consumes
results until the supervisor decides ResearchComplete or hits the iteration cap.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Literal, cast

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool as as_tool
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.core.config import get_settings
from app.workflow.helpers import (
    _create_model,
    _get_notes_from_tool_calls,
    _is_token_limit_exceeded,
)
from app.workflow.state import (
    ConductResearch,
    ResearchComplete,
    ResearcherState,
    Source,
    SupervisorState,
)
from app.workflow.tools.think import think_tool

logger = logging.getLogger(__name__)


def _supervisor_tools() -> list:
    return [as_tool(ConductResearch), as_tool(ResearchComplete), think_tool]


async def supervisor(
    state: SupervisorState, config: RunnableConfig
) -> Command[Literal["supervisor_tools"]]:
    model = (
        _create_model(temperature=0.0)
        .bind_tools(_supervisor_tools())
        .with_retry(stop_after_attempt=3)
    )
    supervisor_messages = state.get("supervisor_messages", [])
    response = await model.ainvoke(supervisor_messages)
    return Command(
        goto="supervisor_tools",
        update={
            "supervisor_messages": [response],
            "research_iterations": state.get("research_iterations", 0) + 1,
        },
    )


async def supervisor_tools(state: SupervisorState, config: RunnableConfig) -> Command:
    settings = get_settings()
    max_units = settings.workflow_max_concurrent_research_units
    max_iterations = settings.workflow_max_researcher_iterations

    supervisor_messages = state.get("supervisor_messages", [])
    iterations = state.get("research_iterations", 0)
    most_recent = cast(AIMessage, supervisor_messages[-1])

    tool_calls = most_recent.tool_calls or []
    exceeded_iterations = iterations > max_iterations
    no_tool_calls = not tool_calls
    research_complete = any(tc["name"] == "ResearchComplete" for tc in tool_calls)

    if exceeded_iterations or no_tool_calls or research_complete:
        return Command(
            goto=END,
            update={
                "notes": _get_notes_from_tool_calls(supervisor_messages),
                "research_brief": state.get("research_brief", ""),
            },
        )

    all_tool_messages: list[ToolMessage] = []
    update: dict[str, Any] = {}

    # think_tool reflections — record then continue.
    for tc in [t for t in tool_calls if t["name"] == "think_tool"]:
        all_tool_messages.append(
            ToolMessage(
                content=f"Reflection recorded: {tc['args'].get('reflection', '')}",
                name="think_tool",
                tool_call_id=tc["id"],
            )
        )

    conduct_calls = [t for t in tool_calls if t["name"] == "ConductResearch"]
    if conduct_calls:
        try:
            allowed = conduct_calls[:max_units]
            overflow = conduct_calls[max_units:]

            results = await asyncio.gather(
                *[
                    _researcher_subgraph().ainvoke(
                        cast(
                            ResearcherState,
                            {
                                "researcher_messages": [
                                    HumanMessage(content=tc["args"]["research_topic"])
                                ],
                                "research_topic": tc["args"]["research_topic"],
                                "tools_to_use": tc["args"].get("tools_to_use", "both"),
                                "section": tc["args"].get("section", "company_overview"),
                                "company_name": state.get("company_name", ""),
                                "website": state.get("website", ""),
                            },
                        ),
                        RunnableConfig(
                            configurable={
                                **((config or {}).get("configurable", {}) or {}),
                                "thread_id": f"researcher-{uuid.uuid4().hex[:12]}",
                            },
                            callbacks=(config or {}).get("callbacks"),
                        ),
                    )
                    for tc in allowed
                ]
            )

            for result, tc in zip(results, allowed):
                all_tool_messages.append(
                    ToolMessage(
                        content=result.get(
                            "compressed_research",
                            "Error: researcher produced no output.",
                        ),
                        name=tc["name"],
                        tool_call_id=tc["id"],
                    )
                )

            for tc in overflow:
                all_tool_messages.append(
                    ToolMessage(
                        content=(
                            f"Skipped: maximum {max_units} concurrent researchers per round. "
                            "Re-dispatch on the next round if still needed."
                        ),
                        name="ConductResearch",
                        tool_call_id=tc["id"],
                    )
                )

            # Aggregate sources + raw notes across researchers.
            aggregated_sources: list[Source] = []
            for r in results:
                for s in r.get("sources", []) or []:
                    aggregated_sources.append(s)
            if aggregated_sources:
                update["sources"] = aggregated_sources

            raw_notes = "\n".join(
                "\n".join(r.get("raw_notes", []) or []) for r in results
            )
            if raw_notes:
                update["raw_notes"] = [raw_notes]

        except Exception as e:  # noqa: BLE001 — token-limit overflow drains gracefully
            logger.exception("supervisor researcher dispatch failed")
            if _is_token_limit_exceeded(e):
                return Command(
                    goto=END,
                    update={
                        "notes": _get_notes_from_tool_calls(supervisor_messages),
                        "research_brief": state.get("research_brief", ""),
                    },
                )
            raise

    update["supervisor_messages"] = all_tool_messages
    return Command(goto="supervisor", update=update)


_supervisor_graph = None


def get_supervisor_subgraph():
    global _supervisor_graph
    if _supervisor_graph is None:
        builder = StateGraph(SupervisorState)
        builder.add_node("supervisor", supervisor)
        builder.add_node("supervisor_tools", supervisor_tools)
        builder.add_edge(START, "supervisor")
        _supervisor_graph = builder.compile()
    return _supervisor_graph


# Defer import to avoid a circular reference (researcher imports supervisor's state types).
def _researcher_subgraph():
    from app.workflow.nodes.researcher import get_researcher_subgraph

    return get_researcher_subgraph()
