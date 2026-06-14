import socket
from collections.abc import Iterator
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, get_current_user
from app.core.config import get_settings
from app.main import create_app


def postgres_reachable() -> bool:
    parsed = urlparse(get_settings().database_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


FAKE_USER = CurrentUser(id="user_test_fixture", email="test@example.com")


@pytest.fixture
def fake_user() -> CurrentUser:
    return FAKE_USER


@pytest.fixture
def client(fake_user: CurrentUser) -> Iterator[TestClient]:
    """TestClient with Clerk auth overridden to a fixed fake user.

    The lifespan still runs `init_db`, so Postgres must be reachable. Tests
    that require a DB depend on this fixture; tests that don't can use
    TestClient(create_app()) directly without the with-block (which skips
    lifespan)."""
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
