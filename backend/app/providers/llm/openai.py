from typing import TypeVar

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class OpenAIProvider:
    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model

    def _client(self, temperature: float) -> ChatOpenAI:
        return ChatOpenAI(api_key=self._api_key, model=self._model, temperature=temperature)

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
