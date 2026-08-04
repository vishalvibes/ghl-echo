create type public.webhook_event_status as enum (
    'pending',
    'processing',
    'waiting_authorization',
    'processed',
    'failed'
);

create table public.webhook_events (
    id uuid primary key default gen_random_uuid(),
    location_id uuid not null references public.locations(id) on delete cascade,
    provider_event_id varchar(128) not null,
    event_type varchar(64) not null,
    payload jsonb not null,
    status public.webhook_event_status not null default 'pending',
    attempts integer not null default 0,
    error text,
    received_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    processed_at timestamptz
);

create unique index webhook_events_delivery_idx
    on public.webhook_events (location_id, event_type, provider_event_id);

create index webhook_events_status_received_idx
    on public.webhook_events (status, received_at);
