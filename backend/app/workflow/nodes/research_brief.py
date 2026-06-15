"""Research brief node.

Turns the user's inputs + clarification answers into a structured ResearchBrief.
The serialized brief plus a system seed message are passed to the supervisor as
its initial state.
"""

from __future__ import annotations

from typing import cast

from langchain_core.messages import HumanMessage, SystemMessage, get_buffer_string
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from app.core.config import get_settings
from app.workflow.helpers import _create_model, _get_today_str
from app.workflow.prompts import lead_researcher_prompt, research_brief_prompt
from app.workflow.state import AgentState, ResearchBrief


def _serialize_brief(brief: ResearchBrief, *, company_name: str, website: str) -> str:
    return (
        f"## Target Company\n{company_name}  ({website})\n\n"
        f"## Research Goal\n{brief.research_goal}\n\n"
        f"## Key Entities\n{', '.join(brief.key_entities) if brief.key_entities else 'None specified'}\n\n"
        f"## Constraints\n{', '.join(brief.constraints) if brief.constraints else 'None specified'}\n\n"
        f"## Source Strategy\n{brief.source_strategy}\n"
    )


async def write_research_brief(state: AgentState, config: RunnableConfig) -> Command:
    settings = get_settings()
    company_name = state.get("company_name", "")
    website = state.get("website", "")
    objective = state.get("objective", "")

    model = _create_model(temperature=0.0).with_structured_output(ResearchBrief).with_retry(
        stop_after_attempt=3
    )
    prompt = research_brief_prompt.format(
        company_name=company_name,
        website=website,
        objective=objective,
        messages=get_buffer_string(state.get("messages", [])),
        date=_get_today_str(),
    )
    brief = cast(ResearchBrief, await model.ainvoke([HumanMessage(content=prompt)]))

    brief_text = _serialize_brief(brief, company_name=company_name, website=website)

    supervisor_system = lead_researcher_prompt.format(
        company_name=company_name,
        website=website,
        date=_get_today_str(),
        max_concurrent_research_units=settings.workflow_max_concurrent_research_units,
        max_researcher_iterations=settings.workflow_max_researcher_iterations,
    )

    return Command(
        goto="create_research_plan",
        update={
            "research_brief": brief_text,
            "supervisor_messages": {
                "type": "override",
                "value": [
                    SystemMessage(content=supervisor_system),
                    HumanMessage(content=brief_text),
                ],
            },
        },
    )
