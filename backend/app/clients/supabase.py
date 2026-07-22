"""Supabase async client factory.

  * URL/key are read straight from the environment.
  * A single process-wide shared httpx.AsyncClient transport is threaded into
    the Supabase client to avoid socket/CLOSE-WAIT leaks under load.
  * The client factory is exposed as a FastAPI dependency.

The backend uses the service-role key (bypasses RLS) for all trusted
server-side work.
"""

from __future__ import annotations

import os

import httpx
from loguru import logger
from supabase import AClient, AsyncClientOptions, acreate_client

from app.core.settings import settings

# --- Shared httpx transport --------------------------------------------------
_shared_httpx_client: httpx.AsyncClient | None = None


def init_shared_supabase_transport() -> None:
    """Create the process-wide shared httpx client. Call once on startup."""
    global _shared_httpx_client
    if _shared_httpx_client is not None:
        return
    limits = httpx.Limits(
        max_connections=settings.SUPABASE_POOL_MAX_CONNECTIONS,
        max_keepalive_connections=settings.SUPABASE_POOL_MAX_KEEPALIVE,
    )
    _shared_httpx_client = httpx.AsyncClient(
        limits=limits, timeout=settings.SUPABASE_TIMEOUT_SECONDS
    )
    logger.info("Initialised shared Supabase httpx transport")


async def close_shared_supabase_transport() -> None:
    """Close the shared httpx client. Call once on shutdown."""
    global _shared_httpx_client
    if _shared_httpx_client is not None:
        await _shared_httpx_client.aclose()
        _shared_httpx_client = None
        logger.info("Closed shared Supabase httpx transport")


# --- Client factory ----------------------------------------------------------
async def create_client() -> AClient:
    """Full-access server client (bypasses RLS) using the shared transport.

    Uses the new Supabase "secret key" (sb_secret_...); falls back to the legacy
    service_role key during migration.
    """
    url = os.environ.get("SUPABASE_URL", settings.SUPABASE_URL)
    key = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or settings.SUPABASE_SECRET_KEY
    )
    options = AsyncClientOptions(httpx_client=_shared_httpx_client)
    return await acreate_client(url, key, options=options)


# --- FastAPI dependency ------------------------------------------------------
async def get_supabase_client() -> AClient:
    """FastAPI dependency: the shared-transport Supabase client."""
    return await create_client()
