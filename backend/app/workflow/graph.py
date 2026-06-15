from collections.abc import Awaitable, Callable
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.workflow.deps import WorkflowDeps
from app.workflow.nodes.assembler import assembler
from app.workflow.nodes.extractor import extractor
from app.workflow.nodes.planner import planner
from app.workflow.nodes.quality_gate import quality_gate
from app.workflow.nodes.researcher import researcher
from app.workflow.nodes.synthesizer import synthesizer
from app.workflow.state import GraphState

NodeFn = Callable[[GraphState, WorkflowDeps], Awaitable[GraphState]]


def _bind(fn: NodeFn, deps: WorkflowDeps) -> Callable[[GraphState], Awaitable[GraphState]]:
    async def wrapped(state: GraphState) -> GraphState:
        return await fn(state, deps)

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

    g.add_node("planner", _bind(planner, deps))
    g.add_node("researcher", _bind(researcher, deps))
    g.add_node("extractor", _bind(extractor, deps))
    g.add_node("synthesizer", _bind(synthesizer, deps))
    g.add_node("quality_gate", _bind(quality_gate, deps))
    g.add_node("assembler", _bind(assembler, deps))

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
