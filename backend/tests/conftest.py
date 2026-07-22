"""Shared test fixtures.

Style matches tests/test_health.py: httpx AsyncClient over ASGITransport, and
`asyncio_mode = "auto"` (see pyproject) so async tests/fixtures need no marker.
Auth tests mint their own Supabase-style JWTs with the same secret the app
verifies against (`settings.SUPABASE_JWT_SECRET`), so no live Supabase Auth is
needed.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import jwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.settings import settings
from app.main import app


@pytest.fixture
async def client():
    """httpx client bound to the FastAPI app (no network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def make_token() -> Callable[..., str]:
    """Factory minting a valid Supabase access token for a given user id."""

    def _make(sub: str = "user-123", *, expires_in: int = 3600, **claims: object) -> str:
        payload = {
            "sub": sub,
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + expires_in,
            **claims,
        }
        return jwt.encode(payload, settings.SUPABASE_JWT_SECRET, algorithm="HS256")

    return _make


@pytest.fixture
def auth_headers(make_token: Callable[..., str]) -> dict[str, str]:
    """Authorization header for the default test user."""
    return {"Authorization": f"Bearer {make_token()}"}


@pytest.fixture(autouse=True)
def _clear_overrides():
    """Ensure dependency overrides never leak between tests."""
    yield
    app.dependency_overrides.clear()
