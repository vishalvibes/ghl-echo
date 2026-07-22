"""Tests for the chat / inference router.

The Azure client is never built in tests — instead the LLM helpers in
app.utils.llm are monkeypatched, so these cover the router contract (auth,
validation, error mapping, SSE framing) without any network.
"""

from types import SimpleNamespace

import pytest


def _completion(content: str, model: str = "gpt-test"):
    """Minimal stand-in for an OpenAI ChatCompletion."""
    message = SimpleNamespace(content=content)
    return SimpleNamespace(choices=[SimpleNamespace(message=message)], model=model)


# --- inference ---------------------------------------------------------------
@pytest.mark.unit
async def test_inference_requires_auth(client):
    res = await client.post("/inference", json={"prompt": "hi"})
    assert res.status_code == 401


@pytest.mark.unit
async def test_inference_returns_completion(client, auth_headers, monkeypatch):
    seen: dict = {}

    async def fake_complete(**kwargs):
        seen.update(kwargs)
        return _completion("pong")

    monkeypatch.setattr("app.routers.chat.create_chat_completion", fake_complete)

    res = await client.post(
        "/inference",
        json={"prompt": "ping", "system": "be terse"},
        headers=auth_headers,
    )

    assert res.status_code == 200
    assert res.json() == {"output": "pong", "model": "gpt-test"}
    # System prompt is prepended, user prompt follows.
    assert [m["role"] for m in seen["messages"]] == ["system", "user"]


@pytest.mark.unit
async def test_inference_rejects_blank_prompt(client, auth_headers):
    res = await client.post("/inference", json={"prompt": "   "}, headers=auth_headers)
    assert res.status_code == 400


@pytest.mark.unit
async def test_inference_503_when_llm_unconfigured(
    client, auth_headers, monkeypatch
):
    async def unconfigured(**_kwargs):
        raise RuntimeError("Azure OpenAI client not initialized")

    monkeypatch.setattr("app.routers.chat.create_chat_completion", unconfigured)

    res = await client.post("/inference", json={"prompt": "hi"}, headers=auth_headers)
    assert res.status_code == 503


@pytest.mark.unit
async def test_inference_502_on_provider_error(client, auth_headers, monkeypatch):
    async def boom(**_kwargs):
        raise ValueError("upstream exploded")

    monkeypatch.setattr("app.routers.chat.create_chat_completion", boom)

    res = await client.post("/inference", json={"prompt": "hi"}, headers=auth_headers)
    assert res.status_code == 502


# --- chat --------------------------------------------------------------------
@pytest.mark.unit
async def test_chat_returns_reply(client, auth_headers, monkeypatch):
    async def fake_complete(**_kwargs):
        return _completion("hello back")

    monkeypatch.setattr("app.routers.chat.create_chat_completion", fake_complete)

    res = await client.post(
        "/chat",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers=auth_headers,
    )

    assert res.status_code == 200
    assert res.json()["reply"] == "hello back"


@pytest.mark.unit
async def test_chat_rejects_empty_messages(client, auth_headers):
    res = await client.post("/chat", json={"messages": []}, headers=auth_headers)
    assert res.status_code == 400


@pytest.mark.unit
async def test_chat_stream_emits_sse_frames(client, auth_headers, monkeypatch):
    async def fake_stream(_messages, **_kwargs):
        yield 'data: {"type": "llm.response", "content": "hi"}\n\n'
        yield 'data: {"type": "response.completed"}\n\n'

    monkeypatch.setattr("app.routers.chat.stream_chat_completion", fake_stream)

    res = await client.post(
        "/chat/stream",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers=auth_headers,
    )

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    assert '"content": "hi"' in res.text
    assert "response.completed" in res.text


@pytest.mark.unit
async def test_chat_stream_surfaces_error_frame(client, auth_headers, monkeypatch):
    async def failing_stream(_messages, **_kwargs):
        raise ValueError("stream died")
        yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr("app.routers.chat.stream_chat_completion", failing_stream)

    res = await client.post(
        "/chat/stream",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers=auth_headers,
    )

    # Status is already 200 once streaming starts — failures ride the body.
    assert res.status_code == 200
    assert '"error"' in res.text


@pytest.mark.unit
async def test_chat_stream_requires_auth(client):
    res = await client.post(
        "/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert res.status_code == 401
