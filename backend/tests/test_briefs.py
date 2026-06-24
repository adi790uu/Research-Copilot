import pytest
from fastapi.testclient import TestClient

from tests.conftest import postgres_reachable

pytestmark = pytest.mark.skipif(
    not postgres_reachable(),
    reason="Postgres unreachable; run `docker compose up postgres -d`",
)


def test_create_then_get_brief(client: TestClient) -> None:
    payload = {
        "company_name": "Acme Test Co",
        "website": "https://acme.example.com",
        "objective": "Integration test for briefs API",
    }
    created = client.post("/briefs", json=payload)
    assert created.status_code == 201
    body = created.json()
    assert body["company_name"] == payload["company_name"]
    assert body["status"] == "pending"

    got = client.get(f"/briefs/{body['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == body["id"]


def test_list_includes_created_brief(client: TestClient) -> None:
    created = client.post(
        "/briefs",
        json={
            "company_name": "ListTestCo",
            "website": "https://list-test.example.com",
            "objective": "appear in list",
        },
    ).json()
    listed = client.get("/briefs").json()
    assert any(b["id"] == created["id"] for b in listed["items"])


def test_get_missing_brief_returns_404(client: TestClient) -> None:
    r = client.get("/briefs/does-not-exist-xyz")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_invalid_payload_returns_422(client: TestClient) -> None:
    r = client.post(
        "/briefs",
        json={"company_name": "", "website": "not-a-url", "objective": ""},
    )
    assert r.status_code == 422


def test_user_isolation(client: TestClient) -> None:
    """Briefs belong to the authenticated user; another user can't see them."""
    from app.core.auth import CurrentUser, get_current_user

    created = client.post(
        "/briefs",
        json={
            "company_name": "PrivateCo",
            "website": "https://private.example.com",
            "objective": "isolation test",
        },
    ).json()

    # Swap the authed user mid-flight to simulate a different signed-in account.
    other = CurrentUser(id="user_other_fixture", email="other@example.com")
    client.app.dependency_overrides[get_current_user] = lambda: other

    listed = client.get("/briefs").json()
    assert all(b["id"] != created["id"] for b in listed["items"]), \
        "Other user must not see PrivateCo brief in their list"

    got = client.get(f"/briefs/{created['id']}")
    assert got.status_code == 404, "Other user must not be able to fetch by id"
