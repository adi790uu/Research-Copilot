import asyncio

from pydantic import BaseModel, Field

from app.domain.report import Source
from app.workflow.deps import WorkflowDeps
from app.workflow.prompts.extractor import EXTRACTOR_PROMPT
from app.workflow.state import Fact, GraphState, NodeError


class _ExtractorOutput(BaseModel):
    facts: list[str] = Field(default_factory=list, max_length=5)


async def extractor(state: GraphState, deps: WorkflowDeps) -> GraphState:
    """For each (source, section) pair, ask the LLM to extract grounded facts.

    To bound cost we only extract for sections that actually had a subquery
    targeting them in this round.
    """
    sources = state.get("sources", [])
    subqueries = state.get("subqueries", [])
    if not sources or not subqueries:
        return {"facts": []}

    sections = sorted({sq.section for sq in subqueries})
    company = state["company_name"]

    async def _extract(source: Source, section: str) -> tuple[list[Fact], NodeError | None]:
        content = source.snippet or ""
        if not content:
            return [], None
        prompt = EXTRACTOR_PROMPT.format(
            company_name=company,
            section=section,
            title=source.title,
            url=source.url,
            content=content[:3000],
        )
        try:
            out = await deps.llm.structured(prompt, _ExtractorOutput)
        except Exception as e:
            return [], NodeError(node="extractor", message=f"{source.id}/{section}: {e}")
        return (
            [Fact(text=t, source_id=source.id, section=section) for t in out.facts if t.strip()],
            None,
        )

    pairs = [(s, sec) for s in sources for sec in sections]
    results = await asyncio.gather(*[_extract(s, sec) for s, sec in pairs])

    facts: list[Fact] = []
    errors: list[NodeError] = []
    for fact_batch, err in results:
        facts.extend(fact_batch)
        if err:
            errors.append(err)
    return {"facts": facts, "errors": errors}
