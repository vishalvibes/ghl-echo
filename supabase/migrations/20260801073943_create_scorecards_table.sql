create table public.scorecards (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    version integer not null,
    pass_threshold integer not null default 70,
    partial_threshold integer not null default 40,
    criteria jsonb not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create unique index scorecards_agent_version_idx
    on public.scorecards (agent_id, version);
create index scorecards_active_idx
    on public.scorecards (agent_id, is_active);
