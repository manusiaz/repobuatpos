-- The platform BorNiz runs on, on plain PostgreSQL 14+ (no Supabase): sign-in accounts, sessions, the request's user,
-- and the two roles every request runs as. Applied before the migrations by scripts/db-migrate.mjs; safe to re-run.
create schema if not exists extensions;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,                      -- scrypt (src/server/auth.ts); null for anonymous devices
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.sessions (
  token_hash text primary key,                  -- sha256 of the bearer token; the token itself is never stored
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on auth.sessions (user_id);
alter table auth.sessions add column if not exists mfa boolean not null default false; -- opened with the authenticator code (BorNiz staff need it)
alter table auth.users add column if not exists meta jsonb not null default '{}';   -- name and phone given at sign-up
create table if not exists auth.one_time (      -- password-reset links (sha256 of the token)
  token_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  purpose text not null,
  expires_at timestamptz not null
);
create table if not exists auth.mfa_factors (   -- TOTP second factor (Settings › Security)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  secret text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- The signed-in user of this request: the API sets it per transaction (set local request.jwt.claim.sub).
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

-- Every request runs as anon (guests, machines, server secret RPCs) or authenticated (a signed-in account);
-- the policies and grants in the migrations are written for these two roles.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- Accounts and sessions are only touched by the API's own login code, never through a role.
revoke all on auth.users, auth.sessions, auth.mfa_factors, auth.one_time from anon, authenticated;
