"""OpenAI client.

Builds a single AsyncOpenAI client at startup when a key is configured, stashes
it on app.state, and exposes a module-global for non-request contexts (e.g.
Inngest handlers). Chat helpers live in app/utils/llm.py.

`OPENAI_BASE_URL` is optional — point it at any OpenAI-compatible gateway
(Azure's /v1 endpoint, OpenRouter, a local server) without touching this code.
"""

from typing import Optional

from fastapi import FastAPI
from loguru import logger
from openai import AsyncOpenAI

from app.core.settings import settings

# Module-global for workflows / background jobs that lack a request scope.
openai_client: Optional[AsyncOpenAI] = None

_DEFAULT_BASE_URL = "https://api.openai.com/v1"


def init_llm_clients(app: FastAPI) -> None:
    """Initialize the OpenAI client (no-op unless enabled + configured)."""
    global openai_client

    if not settings.OPENAI_ENABLED:
        logger.info("OPENAI_ENABLED is false - OpenAI client not initialized")
        return

    if not settings.OPENAI_API_KEY:
        logger.warning(
            "OPENAI_ENABLED is true but OPENAI_API_KEY is missing - "
            "OpenAI client not initialized"
        )
        return

    try:
        # Pass base_url/organization explicitly, always. Left as None the SDK
        # falls back to os.environ["OPENAI_BASE_URL"], and an *empty* value
        # there (a common `.env` shape) yields "Request URL is missing an
        # 'http://' or 'https://' protocol" on every call.
        openai_client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL or _DEFAULT_BASE_URL,
            organization=settings.OPENAI_ORG_ID or None,
        )
        app.state.openai = openai_client
        logger.success(
            f"OpenAI client initialized - model: {settings.OPENAI_MODEL}, "
            f"base_url: {settings.OPENAI_BASE_URL or _DEFAULT_BASE_URL}"
        )
    except Exception as e:
        logger.error(f"Failed to initialize OpenAI client: {e}")


def get_openai_client() -> AsyncOpenAI:
    """Return the process-global OpenAI client, or raise if not initialized."""
    if openai_client is None:
        raise RuntimeError(
            "OpenAI client not initialized - check OPENAI_ENABLED and OPENAI_API_KEY"
        )
    return openai_client
