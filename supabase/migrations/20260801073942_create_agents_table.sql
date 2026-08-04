create table public.agents (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    ghl_agent_id varchar(64) not null,
    name text not null,
    prompt_snapshot text,
    prompt_synced_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index agents_location_ghl_agent_idx
    on public.agents (location_id, ghl_agent_id);
