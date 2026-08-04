#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c '
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )
'

for migration in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$migration")"
  if [ "$(psql "$DATABASE_URL" -Atc "select count(*) from public.schema_migrations where version = '$version'")" = "0" ]; then
    echo "Applying $version"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$migration" -c \
      "insert into public.schema_migrations (version) values ('$version')"
  fi
done
