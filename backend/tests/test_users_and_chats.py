import pytest
from fastapi.testclient import TestClient

from tests.conftest import FAKE_USER, postgres_reachable

pytestmark = pytest.mark.skipif(
    not postgres_reachable(),
    reason="Postgres unreachable; run `docker compose up postgres -d`",
)


def test_me_upserts_local_user(client: TestClient) -> None:
    response = client.get("/me")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == FAKE_USER.id
    assert body["email"] == FAKE_USER.email
    assert body["last_seen_at"]


def test_activity_includes_user_owned_records(client: TestClient) -> None:
    created = client.post(
        "/sessions",
        json={
            "company_name": "ActivityCo",
            "website": "https://activity.example.com",
            "objective": "activity test",
        },
    )
    assert created.status_code == 201

    activity = client.get("/me/activity")
    assert activity.status_code == 200
    body = activity.json()
    assert body["user"]["id"] == FAKE_USER.id
    assert body["session_count"] >= 1
    assert any(s["id"] == created.json()["id"] for s in body["recent_sessions"])


def test_create_chat_and_add_message(client: TestClient) -> None:
    chat = client.post("/chats", json={"title": "Follow-up chat"})
    assert chat.status_code == 201
    chat_body = chat.json()
    assert chat_body["user_id"] == FAKE_USER.id

    message = client.post(
        f"/chats/{chat_body['id']}/messages",
        json={"content": "What changed this quarter?"},
    )
    assert message.status_code == 201
    message_body = message.json()
    assert message_body["chat_id"] == chat_body["id"]
    assert message_body["role"] == "user"

    got = client.get(f"/chats/{chat_body['id']}")
    assert got.status_code == 200
    got_body = got.json()
    assert got_body["id"] == chat_body["id"]
    assert got_body["messages"][0]["id"] == message_body["id"]
