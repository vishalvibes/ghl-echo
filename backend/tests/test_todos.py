"""Tests for the todos router.

Exercises the *real* JWT auth dependency (a minted token) but swaps the Supabase
client for an in-memory fake via `app.dependency_overrides`, so no local
Supabase is required. Demonstrates the house pattern for testing authenticated,
user-scoped routes.
"""

from collections.abc import Callable
from unittest.mock import AsyncMock

import pytest

from app.clients.supabase import get_supabase_client
from app.main import app


# --- in-memory fake Supabase -------------------------------------------------
class _Result:
    def __init__(self, data: list[dict]):
        self.data = data


class _Query:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filters: dict[str, object] = {}
        self._insert: dict | None = None
        self._update: dict | None = None
        self._delete = False

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def eq(self, col: str, val: object):
        self._filters[col] = val
        return self

    def insert(self, payload: dict):
        self._insert = payload
        return self

    def update(self, payload: dict):
        self._update = payload
        return self

    def delete(self):
        self._delete = True
        return self

    async def execute(self):
        if self._insert is not None:
            row = {"id": "generated-id", **self._insert}
            self._rows.append(row)
            return _Result([row])
        matched = [
            r for r in self._rows if all(r.get(k) == v for k, v in self._filters.items())
        ]
        if self._update is not None:
            for r in matched:
                r.update(self._update)
            return _Result(matched)
        if self._delete:
            for r in matched:
                self._rows.remove(r)
            return _Result(matched)
        return _Result(matched)


class _FakeSupabase:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def table(self, _name: str):
        return _Query(self._rows)


@pytest.fixture
def fake_rows() -> list[dict]:
    return [
        {"id": "1", "user_id": "user-1", "title": "mine", "is_complete": False},
        {"id": "2", "user_id": "user-2", "title": "theirs", "is_complete": False},
    ]


@pytest.fixture
def use_fake_supabase(fake_rows: list[dict]):
    app.dependency_overrides[get_supabase_client] = lambda: _FakeSupabase(fake_rows)
    return fake_rows


# --- tests -------------------------------------------------------------------
@pytest.mark.unit
async def test_list_todos_scoped_to_user(
    client, make_token: Callable[..., str], use_fake_supabase
):
    headers = {"Authorization": f"Bearer {make_token('user-1')}"}
    res = await client.get("/todos", headers=headers)

    assert res.status_code == 200
    titles = [t["title"] for t in res.json()]
    assert titles == ["mine"]  # user-2's row is filtered out


@pytest.mark.unit
async def test_create_todo_stamps_user_and_emits_event(
    client, make_token: Callable[..., str], use_fake_supabase, monkeypatch
):
    send = AsyncMock()
    monkeypatch.setattr("app.routers.todos.inngest_client.send", send)

    headers = {"Authorization": f"Bearer {make_token('user-1')}"}
    res = await client.post("/todos", json={"title": "new one"}, headers=headers)

    assert res.status_code == 201
    body = res.json()
    assert body["title"] == "new one"
    assert body["user_id"] == "user-1"  # stamped from the verified token
    send.assert_awaited_once()
