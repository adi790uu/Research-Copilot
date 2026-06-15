from collections.abc import Callable
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

StructuredFactory = Callable[[str, type[BaseModel]], BaseModel]


class MockLLMProvider:
    """Deterministic LLM for tests and offline development.

    `text_responses` is consumed in order for `complete()` calls.
    `structured_factory(prompt, schema) -> schema instance` for `structured()` calls,
    so test cases can route on prompt content / schema type.
    """

    def __init__(
        self,
        *,
        text_responses: list[str] | None = None,
        structured_factory: StructuredFactory | None = None,
    ) -> None:
        self._text = list(text_responses or [])
        self._structured = structured_factory
        self.complete_calls: list[str] = []
        self.structured_calls: list[tuple[str, type[BaseModel]]] = []

    async def complete(self, prompt: str, *, temperature: float = 0.2) -> str:
        self.complete_calls.append(prompt)
        if not self._text:
            return ""
        return self._text.pop(0)

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        *,
        temperature: float = 0.0,
    ) -> T:
        self.structured_calls.append((prompt, schema))
        if self._structured is None:
            raise RuntimeError("MockLLMProvider: structured_factory not configured")
        result = self._structured(prompt, schema)
        if not isinstance(result, schema):
            raise TypeError(f"structured_factory returned {type(result)}, expected {schema}")
        return result
