import asyncio
import hashlib

from app.domain.report import Source
from app.workflow.deps import WorkflowDeps
from app.workflow.state import GraphState, NodeError


def _source_id(url: str) -> str:
    """Stable short id from URL so the same source gets the same id across retries."""
    return "src_" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]


async def researcher(state: GraphState, deps: WorkflowDeps) -> GraphState:
    """Fan-out search across all subqueries, dedup results into sources."""
    subqueries = state.get("subqueries", [])
    if not subqueries:
        return {"sources": []}

    async def _one(query: str) -> list[Source]:
        results = await deps.search.search(query, max_results=deps.search_results_per_query)
        out: list[Source] = []
        for r in results:
            out.append(
                Source(
                    id=_source_id(r.url),
                    url=r.url,
                    title=r.title,
                    snippet=(r.content or r.snippet)[:1200] if (r.content or r.snippet) else None,
                )
            )
        return out

    try:
        per_query = await asyncio.gather(
            *[_one(sq.query) for sq in subqueries],
            return_exceptions=True,
        )
    except Exception as e:
        return {"errors": [NodeError(node="researcher", message=str(e))], "sources": []}

    deduped: dict[str, Source] = {}
    errors: list[NodeError] = []
    for sq, batch in zip(subqueries, per_query, strict=True):
        if isinstance(batch, BaseException):
            errors.append(NodeError(node="researcher", message=f"{sq.query}: {batch}"))
            continue
        for s in batch:
            deduped.setdefault(s.url, s)
    return {"sources": list(deduped.values()), "errors": errors}
