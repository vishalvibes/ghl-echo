create table public.call_actions (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    evaluation_id uuid not null references public.evaluations (id) on delete cascade,
    call_id uuid not null references public.calls (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    turn_start integer not null,
    turn_end integer not null,
    action_type varchar(48) not null,
    reason text not null,
    severity public.severity not null default 'medium',
    status public.action_status not null default 'open',
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create index call_actions_location_status_idx
    on public.call_actions (location_id, status, created_at desc);
