from typing import Protocol

from pydantic import BaseModel


class SearchResult(BaseModel):
    url: str
    title: str
    snippet: str
    content: str | None = None


class SearchProvider(Protocol):
    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]: ...
