"""Top-level LangGraph for the company-research workflow (Graph 1 only).

Topology:
    START
      └─► clarify_with_user ─(needs clarification)─► END
                            └─(no)─► write_research_brief
                                      └─► create_research_plan ─► END

The graph stops once the plan is ready. Phase 2 (supervisor → researchers
→ report) now lives in a separate TypeScript Trigger.dev worker: the
frontend reviews/approves the plan, then `POST /sessions/{id}/plan/approve`
creates the job row and triggers the worker. See
`services/workflow_service.py:approve_plan` and `services/worker_trigger.py`.
"""

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
    # clarify routes via Command(goto=...) — no explicit edge needed for its
    # two terminal paths (END on clarification, write_research_brief on go).
    builder.add_edge("write_research_brief", "create_research_plan")
    builder.add_edge("create_research_plan", END)

    return builder.compile(checkpointer=checkpointer)
