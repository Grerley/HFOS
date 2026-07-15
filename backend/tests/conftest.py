"""Test fixtures. Uses an isolated temp SQLite database per test session."""
from __future__ import annotations

import os
import tempfile

import pytest

# Point the app at an isolated temp DB BEFORE importing app modules.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["HFOS_SECRET_KEY"] = "test-secret"
os.environ["HFOS_AUTO_CREATE_TABLES"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth(client):
    """Register a fresh user+household and return auth headers plus ids."""
    import uuid

    email = f"user-{uuid.uuid4().hex[:8]}@test.com"
    r = client.post(
        "/auth/register",
        json={"name": "Owner", "email": email, "password": "password123",
              "household_name": "Test Household"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    hh = body["households"][0]["id"]
    headers = {"Authorization": f"Bearer {body['access_token']}", "X-Household-Id": str(hh)}
    return {"headers": headers, "household_id": hh, "token": body["access_token"], "email": email}
