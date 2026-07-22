"""Tests for the JWT auth dependency (app/core/auth.py)."""

from collections.abc import Callable

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import get_current_user_id


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.mark.unit
def test_valid_token_returns_sub(make_token: Callable[..., str]):
    assert get_current_user_id(_creds(make_token("abc-123"))) == "abc-123"


@pytest.mark.unit
def test_forged_token_rejected(make_token: Callable[..., str]):
    # Signed with the wrong secret — signature verification must fail.
    forged = jwt.encode(
        {"sub": "attacker", "aud": "authenticated"}, "wrong-secret", algorithm="HS256"
    )
    with pytest.raises(HTTPException) as exc:
        get_current_user_id(_creds(forged))
    assert exc.value.status_code == 401


@pytest.mark.unit
def test_expired_token_rejected(make_token: Callable[..., str]):
    with pytest.raises(HTTPException) as exc:
        get_current_user_id(_creds(make_token(expires_in=-10)))
    assert exc.value.status_code == 401


@pytest.mark.unit
async def test_todos_without_auth_is_unauthorized(client):
    # HTTPBearer(auto_error=True) rejects a missing Authorization header.
    res = await client.get("/todos")
    assert res.status_code in (401, 403)
