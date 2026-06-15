"""Top-level LangGraph for the company-research workflow.

Topology:
    START
      └─► clarify_with_user ─(needs clarification)─► END
                            └─(no)─► write_research_brief
                                      └─► create_research_plan
                                            └─[interrupt_after]─► research_supervisor
                                                                  └─► final_report_generation
                                                                        └─► END
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any, cast

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.domain.events import NodeCompleted, NodeFailed, NodeName, NodeStarted
from app.workflow.deps import WorkflowDeps
from app.workflow.nodes.clarify import clarify_with_user
from app.workflow.nodes.final_report import final_report_generation
from app.workflow.nodes.research_brief import write_research_brief
from app.workflow.nodes.research_plan import create_research_plan
from app.workflow.nodes.supervisor import get_supervisor_subgraph
from app.workflow.state import AgentState

NodeFn = Callable[[AgentState, RunnableConfig], Awaitable[Any]]


def _bind(
    name: NodeName, fn: NodeFn, deps: WorkflowDeps
) -> Callable[[AgentState, RunnableConfig], Awaitable[Any]]:
    async def wrapped(state: AgentState, config: RunnableConfig) -> Any:
        session_id = state.get("session_id", "")
        if deps.emit is not None and session_id:
            await deps.emit(NodeStarted(session_id=session_id, node=name, attempt=1))
        started = time.perf_counter()
        try:
            result = await fn(state, config)
        except Exception as exc:  # noqa: BLE001
            if deps.emit is not None and session_id:
                await deps.emit(
                    NodeFailed(session_id=session_id, node=name, attempt=1, message=str(exc))
                )
            raise
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if deps.emit is not None and session_id:
            await deps.emit(
                NodeCompleted(
                    session_id=session_id, node=name, attempt=1, duration_ms=elapsed_ms
                )
            )
        return result

    return wrapped


def build_graph(
    deps: WorkflowDeps,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
) -> Any:
    builder: StateGraph = StateGraph(AgentState)

    builder.add_node(
        "clarify_with_user",
        _bind(cast(NodeName, "clarify_with_user"), clarify_with_user, deps),
    )
    builder.add_node(
        "write_research_brief",
        _bind(cast(NodeName, "write_research_brief"), write_research_brief, deps),
    )
    builder.add_node(
        "create_research_plan",
        _bind(cast(NodeName, "create_research_plan"), create_research_plan, deps),
    )
    # The supervisor is itself a compiled subgraph; wrap so we still emit events.
    supervisor_subgraph = get_supervisor_subgraph()
    builder.add_node(
        "research_supervisor",
        _bind(cast(NodeName, "research_supervisor"), supervisor_subgraph.ainvoke, deps),  # type: ignore[arg-type]
    )
    builder.add_node(
        "final_report_generation",
        _bind(cast(NodeName, "final_report_generation"), final_report_generation, deps),
    )

    builder.add_edge(START, "clarify_with_user")
    builder.add_edge("write_research_brief", "create_research_plan")
    builder.add_edge("create_research_plan", "research_supervisor")
    builder.add_edge("research_supervisor", "final_report_generation")
    builder.add_edge("final_report_generation", END)

    return builder.compile(
        checkpointer=checkpointer,
        interrupt_after=["create_research_plan"],
    )
