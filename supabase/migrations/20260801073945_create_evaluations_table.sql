create table public.evaluations (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    call_id uuid not null references public.calls (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    scorecard_id uuid not null references public.scorecards (id),
    scorecard_version integer not null,
    overall_score integer not null,
    verdict public.verdict not null,
    summary text not null,
    caller_sentiment varchar(16) not null,
    model varchar(64) not null,
    latency_ms integer not null default 0,
    prompt_tokens integer not null default 0,
    completion_tokens integer not null default 0,
    missing_keys jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create unique index evaluations_call_version_idx
    on public.evaluations (call_id, scorecard_version);
create index evaluations_agent_created_idx
    on public.evaluations (agent_id, created_at desc);
