-- todos: example table backing app/routers/todos.py

create table if not exists public.todos (
    id uuid primary key default gen_random_uuid(),
    -- Owner: auth.users.id, taken from the verified Supabase JWT. Not a FK so
    -- seeding doesn't require a real auth user. The backend scopes every query
    -- by this column (isolation is enforced in app code, not via RLS).
    user_id uuid not null,
    title text not null,
    description text,
    is_complete boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists todos_user_id_idx on public.todos (user_id);

-- keep updated_at fresh on writes
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger todos_set_updated_at
    before update on public.todos
    for each row
    execute function public.set_updated_at();

-- Row Level Security: enabled with no policies, so only the service-role key
-- (used by the backend) can access the table. Add policies before exposing it
-- to the anon/authenticated roles directly from the browser.
alter table public.todos enable row level security;
