from tavily import AsyncTavilyClient

from app.providers.search.base import SearchResult


class TavilySearchProvider:
    def __init__(self, api_key: str) -> None:
        self._client = AsyncTavilyClient(api_key=api_key)

    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        response = await self._client.search(
            query=query,
            max_results=max_results,
            search_depth="basic",
        )
        return [
            SearchResult(
                url=r["url"],
                title=r.get("title", r["url"]),
                snippet=r.get("content", "")[:400],
                content=r.get("raw_content") or r.get("content"),
            )
            for r in response.get("results", [])
        ]
