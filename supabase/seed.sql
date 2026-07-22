-- Seed data loaded on `supabase start` / `supabase db reset`.

-- Canonical test user. Sign in through the frontend with:
--   email:    e2e-test@example.com
--   password: testpass123
-- Same account the Playwright e2e suite uses (E2E_EMAIL / E2E_PASSWORD).
-- Email confirmations are off locally (config.toml), but we set
-- email_confirmed_at anyway so the account is usable immediately.
-- Only created if the email is not already present (idempotent; also avoids a
-- unique-email crash if the account was made via the signup form first).
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
)
select
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'e2e-test@example.com',
    extensions.crypt('testpass123', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    '', '', '', ''
where not exists (
    select 1 from auth.users where email = 'e2e-test@example.com'
);

-- Matching identity row so gotrue can resolve the email/password login.
-- Only created if this user has no email identity yet.
insert into auth.identities (
    id, user_id, provider_id, identity_data,
    provider, last_sign_in_at, created_at, updated_at
)
select
    extensions.gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"e2e-test@example.com","email_verified":true,"phone_verified":false}',
    'email', now(), now(), now()
where not exists (
    select 1 from auth.identities
    where provider = 'email'
      and user_id = '11111111-1111-1111-1111-111111111111'
);

-- Demo todos owned by the test user above, so they show up on first sign-in.
-- Only inserted if this user has no todos yet.
insert into public.todos (user_id, title, description, is_complete)
select v.user_id, v.title, v.description, v.is_complete
from (values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Read the README', 'Get the stack running locally', true),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Wire up your first route', 'Add a router under backend/app/routers', false)
) as v(user_id, title, description, is_complete)
where not exists (
    select 1 from public.todos
    where user_id = '11111111-1111-1111-1111-111111111111'
);
