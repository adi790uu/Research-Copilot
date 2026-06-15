from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMProvider(Protocol):
    """Interface for LLM access. Nodes depend on this, not on a concrete vendor.

    Two methods cover all node needs: free-form text (synthesizer) and
    typed-object output (planner, extractor, quality_gate).
    """

    async def complete(self, prompt: str, *, temperature: float = 0.2) -> str: ...

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        *,
        temperature: float = 0.0,
    ) -> T: ...
