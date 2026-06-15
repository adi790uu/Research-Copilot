from app.workflow.deps import WorkflowDeps
from app.workflow.state import GraphState


async def assembler(state: GraphState, deps: WorkflowDeps) -> GraphState:
    """Final pass: ensure the report carries the full, deduped source list.

    The synthesizer already builds a ReportContent; here we just guarantee the
    sources field reflects the latest deduped set on state.
    """
    report = state.get("report")
    if report is None:
        return {}
    sources = state.get("sources", [])
    refreshed = report.model_copy(update={"sources": sources})
    return {"report": refreshed}
