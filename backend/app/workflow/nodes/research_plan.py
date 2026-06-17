"""Research plan node.

Produces an ordered list of subtopics, each with a tool routing hint
(company_site / web / both). The supervisor turns each subtopic into a
ConductResearch dispatch.
"""

from __future__ import annotations

from typing import Any, cast

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from app.workflow.helpers import _create_model, _get_today_str
from app.workflow.prompts import research_plan_prompt
from app.workflow.state import AgentState, ResearchPlan


def _render_plan(plan: ResearchPlan) -> str:
    lines = [f"## Strategy\n{plan.strategy_summary}", "", "## Subtopics"]
    for i, st in enumerate(plan.subtopics, 1):
        lines.append(
            f"{i}. [{st.priority.upper()}] [{st.tools.upper()}] :: {st.title}\n"
            f"   {st.description}"
        )
    return "\n".join(lines)


async def create_research_plan(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    model = _create_model(temperature=0.0).with_structured_output(ResearchPlan).with_retry(
        stop_after_attempt=3
    )

    prompt = research_plan_prompt.format(
        company_name=state.get("company_name", ""),
        website=state.get("website", ""),
        research_brief=state.get("research_brief", ""),
        date=_get_today_str(),
    )

    plan = cast(ResearchPlan, await model.ainvoke([HumanMessage(content=prompt)]))
    strategy_text = _render_plan(plan)

    return {
        # Serialise to a plain dict so the langgraph checkpointer doesn't have
        # to deserialise an app-defined Pydantic type on resume.
        "research_plan": plan.model_dump(mode="json"),
        "messages": [
            AIMessage(
                content=plan.user_message,
                additional_kwargs={"plan_ready": True},
            )
        ],
        "supervisor_messages": [HumanMessage(content=strategy_text)],
    }
