create table public.locations (
    id uuid primary key default gen_random_uuid(),
    ghl_location_id varchar(64) not null unique,
    ghl_company_id varchar(64),
    name text not null default 'Unnamed location',
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    scopes text,
    installed_at timestamptz not null default now(),
    uninstalled_at timestamptz
);
