create table public.findings (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    evaluation_id uuid not null references public.evaluations (id) on delete cascade,
    call_id uuid not null references public.calls (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    type varchar(48) not null,
    severity public.severity not null,
    title text not null,
    detail text not null,
    quote text,
    turn_ids jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index findings_agent_type_idx
    on public.findings (agent_id, type, created_at desc);
