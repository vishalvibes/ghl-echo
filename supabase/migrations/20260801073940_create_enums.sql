create type public.action_status as enum ('open', 'done', 'dismissed');
create type public.call_direction as enum ('inbound', 'outbound');
create type public.call_outcome as enum ('completed', 'no_answer', 'voicemail', 'busy', 'failed');
create type public.ingest_status as enum ('pending', 'evaluated', 'skipped', 'failed');
create type public.severity as enum ('low', 'medium', 'high');
create type public.verdict as enum ('pass', 'partial', 'fail');
