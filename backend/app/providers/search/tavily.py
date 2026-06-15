from collections.abc import Sequence
from typing import Any, Literal

from tavily import AsyncTavilyClient

from app.providers.search.base import ExtractedPage, MappedUrl, SearchResult, SearchTopic


class TavilySearchProvider:
    def __init__(self, api_key: str) -> None:
        self._client = AsyncTavilyClient(api_key=api_key)

    async def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        search_depth: Literal["basic", "advanced"] = "basic",
        topic: SearchTopic = "general",
        include_domains: Sequence[str] | None = None,
        include_raw_content: bool | Literal["markdown", "text"] = False,
        time_range: Literal["day", "week", "month", "year"] | None = None,
    ) -> list[SearchResult]:
        kwargs: dict[str, Any] = {
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "topic": topic,
            "include_raw_content": include_raw_content,
        }
        if include_domains:
            kwargs["include_domains"] = list(include_domains)
        if time_range:
            kwargs["time_range"] = time_range

        response = await self._client.search(**kwargs)
        return [
            SearchResult(
                url=r["url"],
                title=r.get("title", r["url"]),
                snippet=(r.get("content") or "")[:400],
                content=r.get("raw_content") or r.get("content"),
            )
            for r in response.get("results", [])
        ]

    async def extract(
        self,
        urls: Sequence[str],
        *,
        extract_depth: Literal["basic", "advanced"] = "basic",
    ) -> list[ExtractedPage]:
        if not urls:
            return []
        response = await self._client.extract(
            urls=list(urls),
            extract_depth=extract_depth,
            format="markdown",
        )
        return [
            ExtractedPage(
                url=r["url"],
                content=r.get("raw_content") or "",
                title=r.get("title"),
            )
            for r in response.get("results", [])
        ]

    async def map(
        self,
        url: str,
        *,
        max_depth: int = 2,
        limit: int = 30,
        categories: Sequence[str] | None = None,
    ) -> list[MappedUrl]:
        kwargs: dict[str, Any] = {
            "url": url,
            "max_depth": max_depth,
            "limit": limit,
        }
        if categories:
            kwargs["categories"] = list(categories)

        response = await self._client.map(**kwargs)
        items = response.get("results", [])
        out: list[MappedUrl] = []
        for r in items:
            if isinstance(r, str):
                out.append(MappedUrl(url=r))
            else:
                out.append(MappedUrl(url=r["url"], title=r.get("title")))
        return out
