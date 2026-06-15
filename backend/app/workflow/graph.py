import time
from collections.abc import Awaitable, Callable
from typing import Any, cast

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.domain.events import NodeCompleted, NodeFailed, NodeName, NodeStarted
from app.workflow.deps import WorkflowDeps
from app.workflow.nodes.assembler import assembler
from app.workflow.nodes.extractor import extractor
from app.workflow.nodes.planner import planner
from app.workflow.nodes.quality_gate import quality_gate
from app.workflow.nodes.researcher import researcher
from app.workflow.nodes.synthesizer import synthesizer
from app.workflow.state import GraphState

NodeFn = Callable[[GraphState, WorkflowDeps], Awaitable[GraphState]]


def _bind(
    name: NodeName, fn: NodeFn, deps: WorkflowDeps
) -> Callable[[GraphState], Awaitable[GraphState]]:
    async def wrapped(state: GraphState) -> GraphState:
        session_id = state.get("session_id", "")
        # Planner is what increments `attempt`; while it runs, state still holds
        # the pre-increment value, so report it as "starting attempt N+1".
        raw = int(state.get("attempt", 0) or 0)
        attempt = max(1, raw + 1 if name == "planner" else raw)

        if deps.emit is not None and session_id:
            await deps.emit(
                NodeStarted(session_id=session_id, node=name, attempt=attempt)
            )

        started = time.perf_counter()
        try:
            result = await fn(state, deps)
        except Exception as exc:  # noqa: BLE001 — emit & rethrow so the graph terminates
            if deps.emit is not None and session_id:
                await deps.emit(
                    NodeFailed(
                        session_id=session_id,
                        node=name,
                        attempt=attempt,
                        message=str(exc),
                    )
                )
            raise

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if deps.emit is not None and session_id:
            await deps.emit(
                NodeCompleted(
                    session_id=session_id,
                    node=name,
                    attempt=attempt,
                    duration_ms=elapsed_ms,
                )
            )
        return result

    return wrapped


def _route_after_quality(state: GraphState) -> str:
    quality = state.get("quality")
    if quality is None or quality.passed:
        return "assembler"
    return "researcher"


def build_graph(
    deps: WorkflowDeps,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
) -> Any:
    g: StateGraph = StateGraph(GraphState)

    g.add_node("planner", _bind(cast(NodeName, "planner"), planner, deps))
    g.add_node("researcher", _bind(cast(NodeName, "researcher"), researcher, deps))
    g.add_node("extractor", _bind(cast(NodeName, "extractor"), extractor, deps))
    g.add_node("synthesizer", _bind(cast(NodeName, "synthesizer"), synthesizer, deps))
    g.add_node("quality_gate", _bind(cast(NodeName, "quality_gate"), quality_gate, deps))
    g.add_node("assembler", _bind(cast(NodeName, "assembler"), assembler, deps))

    g.add_edge(START, "planner")
    g.add_edge("planner", "researcher")
    g.add_edge("researcher", "extractor")
    g.add_edge("extractor", "synthesizer")
    g.add_edge("synthesizer", "quality_gate")
    g.add_conditional_edges(
        "quality_gate",
        _route_after_quality,
        {"researcher": "researcher", "assembler": "assembler"},
    )
    g.add_edge("assembler", END)

    return g.compile(checkpointer=checkpointer) if checkpointer else g.compile()
