from collections.abc import AsyncIterator
from typing import Any, TypeVar

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.workflow.helpers import _model_accepts_temperature

T = TypeVar("T", bound=BaseModel)


class OpenAIProvider:
    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url or None

    def _client(self, temperature: float) -> ChatOpenAI:
        kwargs: dict[str, Any] = {
            "api_key": self._api_key,
            "model": self._model,
            "base_url": self._base_url,
        }
        # GPT-5 / o-series only accept the default temperature; sending one
        # produces a 400. Omit on those families so the SDK uses the default.
        if _model_accepts_temperature(self._model):
            kwargs["temperature"] = temperature
        return ChatOpenAI(**kwargs)

    async def complete(self, prompt: str, *, temperature: float = 0.2) -> str:
        result = await self._client(temperature).ainvoke([HumanMessage(content=prompt)])
        content = result.content
        if isinstance(content, list):
            return "".join(part for part in content if isinstance(part, str))
        return str(content)

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        *,
        temperature: float = 0.0,
    ) -> T:
        client = self._client(temperature).with_structured_output(schema)
        return await client.ainvoke([HumanMessage(content=prompt)])  # type: ignore[return-value]

    async def stream(self, prompt: str, *, temperature: float = 0.2) -> AsyncIterator[str]:
        async for chunk in self._client(temperature).astream([HumanMessage(content=prompt)]):
            content = chunk.content
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, str) and part:
                        yield part
            elif content:
                yield str(content)
