from collections import Counter

from app.workflow.deps import WorkflowDeps
from app.workflow.prompts.quality_gate import QUALITY_GATE_PROMPT
from app.workflow.state import GraphState, NodeError, QualityCheck, SubQuery

CRITICAL_SECTIONS = (
    "company_overview",
    "products_and_services",
    "target_customers",
    "business_signals",
)


async def quality_gate(state: GraphState, deps: WorkflowDeps) -> GraphState:
    facts = state.get("facts", [])
    counts = Counter(f.section for f in facts)
    attempt = state.get("attempt", 1)
    max_attempts = state.get("max_attempts", 2)
    source_count = len({s.url for s in state.get("sources", [])})

    fact_counts_str = "\n".join(f"- {s}: {counts.get(s, 0)}" for s in CRITICAL_SECTIONS)

    # Cheap pre-check: if no critical section is thin, skip the LLM call.
    thin = [s for s in CRITICAL_SECTIONS if counts.get(s, 0) < 2]
    if not thin or attempt >= max_attempts:
        return {
            "quality": QualityCheck(
                passed=True,
                reasoning=(
                    "All critical sections have ≥2 grounded facts."
                    if not thin
                    else f"Used max attempts ({max_attempts}); accepting current draft."
                ),
                missing_sections=thin,
            )
        }

    prompt = QUALITY_GATE_PROMPT.format(
        company_name=state["company_name"],
        objective=state["objective"],
        fact_counts=fact_counts_str,
        source_count=source_count,
        attempt=attempt,
        max_attempts=max_attempts,
    )
    try:
        check = await deps.llm.structured(prompt, QualityCheck)
    except Exception as e:
        return {
            "quality": QualityCheck(passed=True, reasoning=f"quality LLM failed: {e}"),
            "errors": [NodeError(node="quality_gate", message=str(e))],
        }

    delta: GraphState = {"quality": check}
    if not check.passed and check.refined_subqueries:
        delta["subqueries"] = _sanitize_subqueries(check.refined_subqueries)
        delta["attempt"] = attempt + 1
    return delta


def _sanitize_subqueries(items: list[SubQuery]) -> list[SubQuery]:
    return [sq for sq in items if sq.query.strip()][:5]
