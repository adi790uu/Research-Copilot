from pydantic import BaseModel, Field

from app.workflow.deps import WorkflowDeps
from app.workflow.prompts.planner import PLANNER_PROMPT
from app.workflow.state import GraphState, NodeError, SubQuery


class _PlannerOutput(BaseModel):
    subqueries: list[SubQuery] = Field(..., min_length=1, max_length=8)


async def planner(state: GraphState, deps: WorkflowDeps) -> GraphState:
    prompt = PLANNER_PROMPT.format(
        company_name=state["company_name"],
        website=state.get("website", ""),
        objective=state["objective"],
    )
    try:
        plan = await deps.llm.structured(prompt, _PlannerOutput)
    except Exception as e:  # surface as state error; let graph proceed with empty plan
        return {
            "subqueries": [],
            "errors": [NodeError(node="planner", message=str(e))],
            "attempt": state.get("attempt", 0) + 1,
        }
    return {
        "subqueries": plan.subqueries,
        "attempt": state.get("attempt", 0) + 1,
    }
