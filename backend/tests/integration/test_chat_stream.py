"""Integration test: POST /chats/{id}/messages/stream with a mock LLM."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.chats import get_llm_provider
from app.core.auth import get_current_user
from app.main import create_app
from app.providers.llm.mock import MockLLMProvider
from tests.conftest import FAKE_USER, postgres_reachable

pytestmark = pytest.mark.skipif(
    not postgres_reachable(),
    reason="Postgres unreachable; run `docker compose up postgres -d`",
)


@pytest.fixture
def mock_llm() -> MockLLMProvider:
    return MockLLMProvider(
        stream_responder=lambda _prompt: ["Hello", " from", " mock", " [s1]."],
    )


@pytest.fixture
def client(mock_llm: MockLLMProvider) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    app.dependency_overrides[get_llm_provider] = lambda: mock_llm
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_stream_yields_tokens_and_persists_assistant_message(
    client: TestClient, mock_llm: MockLLMProvider
) -> None:
    chat = client.post("/chats", json={"title": "Streaming chat"}).json()

    with client.stream(
        "POST",
        f"/chats/{chat['id']}/messages/stream",
        json={"content": "Tell me about the company."},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    # Each chunk produced by the mock should appear on a `data:` line.
    for chunk in ["Hello", " from", " mock", " [s1]."]:
        assert f"data: {chunk}\n" in body
    assert "event: token" in body
    assert "event: done" in body

    # User + assistant messages are persisted in order.
    got = client.get(f"/chats/{chat['id']}").json()
    roles = [m["role"] for m in got["messages"]]
    assert roles == ["user", "assistant"]
    assert got["messages"][0]["content"] == "Tell me about the company."
    assert got["messages"][1]["content"] == "Hello from mock [s1]."

    assert mock_llm.stream_calls and "Tell me about the company." in mock_llm.stream_calls[0]


def test_stream_assembles_prompt_with_user_message_only_without_session(
    client: TestClient, mock_llm: MockLLMProvider
) -> None:
    """Without a session-linked report, the prompt notes no briefing is available
    but still asks the user's question. (Briefing inclusion is covered by the
    unit tests for `_format_report_context` / `_assemble_prompt`.)"""
    chat = client.post("/chats", json={"title": "No-session chat"}).json()

    with client.stream(
        "POST",
        f"/chats/{chat['id']}/messages/stream",
        json={"content": "Question without context."},
    ) as response:
        assert response.status_code == 200
        list(response.iter_text())

    assert mock_llm.stream_calls
    prompt = mock_llm.stream_calls[-1]
    assert "(no briefing available" in prompt
    assert "Question without context." in prompt
