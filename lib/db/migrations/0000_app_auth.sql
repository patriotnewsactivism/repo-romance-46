-- First-party authentication.
--
-- Replaces Supabase Auth. Sessions are opaque random tokens; only their
-- SHA-256 hash is stored, so a database read cannot be replayed as a login.
-- Passwords are scrypt hashes (node:crypto), never plaintext.

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  password_hash text,
  display_name text,
  avatar_url text,
  github_user_id text unique,
  github_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: users type their address however they like.
create unique index if not exists app_users_email_lower_idx
  on app_users (lower(email))
  where email is not null;

create table if not exists app_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);

create index if not exists app_sessions_user_idx on app_sessions (user_id);
create index if not exists app_sessions_expires_idx on app_sessions (expires_at);
