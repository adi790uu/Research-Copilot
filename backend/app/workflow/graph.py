from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.workflow.nodes.clarify import clarify_with_user
from app.workflow.nodes.research_brief import write_research_brief
from app.workflow.nodes.research_plan import create_research_plan
from app.workflow.state import AgentState


def build_graph(*, checkpointer: BaseCheckpointSaver | None = None) -> Any:
    builder: StateGraph = StateGraph(AgentState)

    builder.add_node("clarify_with_user", clarify_with_user)
    builder.add_node("write_research_brief", write_research_brief)
    builder.add_node("create_research_plan", create_research_plan)

    builder.add_edge(START, "clarify_with_user")
    builder.add_edge("write_research_brief", "create_research_plan")
    builder.add_edge("create_research_plan", END)

    return builder.compile(checkpointer=checkpointer)
