from collections.abc import Callable, Sequence
from typing import Literal

from app.providers.search.base import ExtractedPage, MappedUrl, SearchResult, SearchTopic


class MockSearchProvider:
    """Deterministic search for tests.

    `responder(query) -> list[SearchResult]` lets tests vary results per query.
    Falls back to `default_results` if no responder is set. `extract_responder`
    and `map_responder` follow the same pattern.
    """

    def __init__(
        self,
        *,
        responder: Callable[[str], list[SearchResult]] | None = None,
        default_results: list[SearchResult] | None = None,
        extract_responder: Callable[[Sequence[str]], list[ExtractedPage]] | None = None,
        map_responder: Callable[[str], list[MappedUrl]] | None = None,
    ) -> None:
        self._responder = responder
        self._default = default_results or []
        self._extract_responder = extract_responder
        self._map_responder = map_responder
        self.calls: list[str] = []
        self.extract_calls: list[Sequence[str]] = []
        self.map_calls: list[str] = []

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
        self.calls.append(query)
        results = self._responder(query) if self._responder else self._default
        return results[:max_results]

    async def extract(
        self,
        urls: Sequence[str],
        *,
        extract_depth: Literal["basic", "advanced"] = "basic",
    ) -> list[ExtractedPage]:
        self.extract_calls.append(tuple(urls))
        if self._extract_responder:
            return self._extract_responder(urls)
        return [
            ExtractedPage(url=u, content=f"Mock extracted content for {u}", title=u)
            for u in urls
        ]

    async def map(
        self,
        url: str,
        *,
        max_depth: int = 2,
        limit: int = 30,
        categories: Sequence[str] | None = None,
    ) -> list[MappedUrl]:
        self.map_calls.append(url)
        if self._map_responder:
            return self._map_responder(url)
        return [
            MappedUrl(url=f"{url.rstrip('/')}/about", title="About"),
            MappedUrl(url=f"{url.rstrip('/')}/pricing", title="Pricing"),
            MappedUrl(url=f"{url.rstrip('/')}/blog", title="Blog"),
        ]
