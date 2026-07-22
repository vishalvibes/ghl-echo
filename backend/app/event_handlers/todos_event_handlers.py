"""Inngest functions for the todos domain (example).

Durable background functions triggered by events. Registered with the app via
``inngest.fast_api.serve`` in app/main.py. Fired by the todos router when a todo
is created (event ``todos/todo.created``).

House style (see harmony-fragment): one ``<domain>_event_handlers.py`` per
domain, ``handle_*`` async functions taking an ``inngest.Context``, loguru for
in-handler logging. Do real durable work through ``ctx.step`` so each step is
retried independently.
"""

import inngest
from loguru import logger

from app.clients.inngest import inngest_client


@inngest_client.create_function(
    fn_id="todo-created",
    trigger=inngest.TriggerEvent(event="todos/todo.created"),
)
async def handle_todo_created(ctx: inngest.Context) -> str:
    """Example handler: runs in the background after a todo is created.

    Event data: ``{"todo_id": str, "title": str}``. Replace the body with real
    durable work (notifications, enrichment, ...) wrapped in ``ctx.step``.
    """
    logger.info(f"[inngest] todo created: {ctx.event.data}")
    return "ok"
