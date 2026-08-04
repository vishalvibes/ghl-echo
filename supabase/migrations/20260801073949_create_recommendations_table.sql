create table public.recommendations (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    "window" varchar(8) not null,
    evidence_hash varchar(64) not null,
    based_on_calls integer not null,
    items jsonb not null,
    model varchar(64) not null,
    created_at timestamptz not null default now()
);

create unique index recommendations_agent_window_hash_idx
    on public.recommendations (agent_id, "window", evidence_hash);
