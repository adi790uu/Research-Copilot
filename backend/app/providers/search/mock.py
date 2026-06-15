from collections.abc import Callable

from app.providers.search.base import SearchResult


class MockSearchProvider:
    """Deterministic search for tests.

    `responder(query) -> list[SearchResult]` lets tests vary results per query.
    Falls back to `default_results` if no responder is set.
    """

    def __init__(
        self,
        *,
        responder: Callable[[str], list[SearchResult]] | None = None,
        default_results: list[SearchResult] | None = None,
    ) -> None:
        self._responder = responder
        self._default = default_results or []
        self.calls: list[str] = []

    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        self.calls.append(query)
        results = self._responder(query) if self._responder else self._default
        return results[:max_results]
