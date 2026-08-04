create table public.criterion_results (
    id uuid primary key default gen_random_uuid(),
    evaluation_id uuid not null references public.evaluations (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    criterion_key varchar(64) not null,
    met boolean not null,
    value text,
    confidence real not null default 0,
    evidence_turn_ids jsonb not null default '[]'::jsonb,
    rationale text not null default '',
    created_at timestamptz not null default now()
);

create unique index criterion_results_eval_key_idx
    on public.criterion_results (evaluation_id, criterion_key);
create index criterion_results_agent_key_idx
    on public.criterion_results (agent_id, criterion_key, created_at desc);
