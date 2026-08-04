create table public.calls (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations (id) on delete cascade,
    agent_id uuid not null references public.agents (id) on delete cascade,
    ghl_call_id varchar(128) not null,
    contact_name text,
    contact_phone varchar(32),
    direction public.call_direction not null,
    outcome public.call_outcome not null default 'completed',
    started_at timestamptz not null,
    duration_sec integer not null default 0,
    transcript jsonb not null,

    -- JSON is the source of truth; only chart-used values are projected.
    metrics jsonb,
    agent_talk_ratio real generated always as
        (((metrics ->> 'talkRatio')::real)) stored,
    interruption_rate real generated always as
        (((metrics #>> '{endpointing,interruptionRate}')::real)) stored,
    caller_repeat_rate real generated always as
        (((metrics #>> '{comprehension,callerRepeatRate}')::real)) stored,

    -- Model assessment and generated projections used by trend queries.
    quality jsonb,
    call_completed boolean generated always as
        (((quality ->> 'callCompleted')::boolean)) stored,
    task_outcome varchar(32) generated always as
        ((quality #>> '{outcome,result}')) stored,
    script_adherence_score integer generated always as
        (((quality #>> '{scriptAdherence,score}')::integer)) stored,
    comprehension_score integer generated always as
        (((quality #>> '{comprehension,score}')::integer)) stored,
    tone_score integer generated always as
        (((quality #>> '{tone,score}')::integer)) stored,
    caller_sentiment varchar(16) generated always as
        ((quality ->> 'callerSentiment')) stored,
    premature_hangup boolean generated always as
        (((quality ->> 'prematureHangup')::boolean)) stored,
    captured_name boolean generated always as
        (((quality #>> '{informationCaptured,name}')::boolean)) stored,
    captured_email boolean generated always as
        (((quality #>> '{informationCaptured,email}')::boolean)) stored,
    captured_phone boolean generated always as
        (((quality #>> '{informationCaptured,phone}')::boolean)) stored,

    ingest_status public.ingest_status not null default 'pending',
    ingest_error text,
    is_mock boolean not null default false,
    created_at timestamptz not null default now(),

    constraint calls_agent_talk_ratio_valid
        check (agent_talk_ratio is null or agent_talk_ratio between 0 and 1),
    constraint calls_interruption_rate_valid
        check (interruption_rate is null or interruption_rate between 0 and 1),
    constraint calls_caller_repeat_rate_valid
        check (caller_repeat_rate is null or caller_repeat_rate between 0 and 1),
    constraint calls_script_score_valid
        check (script_adherence_score is null or script_adherence_score between 1 and 5),
    constraint calls_comprehension_score_valid
        check (comprehension_score is null or comprehension_score between 1 and 5),
    constraint calls_tone_score_valid
        check (tone_score is null or tone_score between 1 and 5)
);

create unique index calls_location_ghl_call_idx
    on public.calls (location_id, ghl_call_id);
create index calls_agent_started_idx
    on public.calls (agent_id, started_at desc);
create index calls_location_started_idx
    on public.calls (location_id, started_at desc);
