"""Todos routes — example CRUD wired to Supabase.

Demonstrates the house style: a fat router with inline Pydantic models and the
Supabase client injected as a FastAPI dependency. Backed by the `todos` table
created in supabase/migrations.

Auth: every route requires a verified Supabase JWT (`get_current_user_id`) and
scopes its query to that user via the `user_id` column. The service-role client
bypasses RLS, so this app-level scoping is what isolates users' data.
"""

import inngest
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import AClient

from app.clients.inngest import inngest_client
from app.clients.supabase import get_supabase_client
from app.core.auth import get_current_user_id

router = APIRouter(tags=["todos"])

_TABLE = "todos"


# --- models ------------------------------------------------------------------
class TodoCreate(BaseModel):
    title: str
    description: str | None = None


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    is_complete: bool | None = None


# --- routes ------------------------------------------------------------------
@router.get("/todos")
async def list_todos(
    limit: int = 100,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> list[dict]:
    limit = min(limit, 1000)
    res = (
        await supabase.table(_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data


@router.post("/todos", status_code=201)
async def create_todo(
    body: TodoCreate,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> dict:
    payload = {**body.model_dump(), "user_id": user_id}
    res = await supabase.table(_TABLE).insert(payload).execute()
    todo = res.data[0]
    # Kick off durable background work via Inngest (handled in
    # app/event_handlers/todos_event_handlers.py). Requires the Dev Server
    # (`make inngest`) running locally.
    await inngest_client.send(
        inngest.Event(
            name="todos/todo.created",
            data={"todo_id": todo["id"], "title": todo["title"], "user_id": user_id},
        )
    )
    return todo


@router.patch("/todos/{todo_id}")
async def update_todo(
    todo_id: str,
    body: TodoUpdate,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> dict:
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = (
        await supabase.table(_TABLE)
        .update(payload)
        .eq("id", todo_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Todo not found")
    return res.data[0]


@router.delete("/todos/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> None:
    await (
        supabase.table(_TABLE)
        .delete()
        .eq("id", todo_id)
        .eq("user_id", user_id)
        .execute()
    )
