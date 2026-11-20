-- Ported from supabase/migrations/20261120090000_github_repo_sync.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

-- GitHub repository synchronization.
--
-- Repositories were fetched live from three routes with `affiliation=owner`,
-- so organization and collaborator repositories never appeared, and a rate
-- limit or expired token emptied the portfolio. This table is the durable
-- result of one paginated sync across every affiliation the user can access.

create table if not exists public.github_repos (
  user_id uuid not null references app_users (id) on delete cascade,
  github_id text not null,
  full_name text not null,
  name text not null,
  owner text not null,
  description text,
  language text,
  topics text[] not null default '{}',
  private boolean not null default false,
  fork boolean not null default false,
  archived boolean not null default false,
  disabled boolean not null default false,
  stars integer not null default 0,
  forks integer not null default 0,
  open_issues integer not null default 0,
  watchers integer not null default 0,
  size_kb integer not null default 0,
  default_branch text,
  pushed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  html_url text,
  synced_at timestamptz not null default now(),
  primary key (user_id, github_id)
);


create index if not exists github_repos_user_pushed_idx
  on public.github_repos (user_id, pushed_at desc nulls last);


comment on table public.github_repos is
  'Durable cache of the repositories a user can access, written by one paginated GitHub sync across owner, collaborator, and organization affiliations.';


-- Connection metadata that lets the UI explain sync state instead of showing
-- an empty portfolio.
alter table public.github_connections
  add column if not exists scopes text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists repo_count integer;


comment on column public.github_connections.scopes is
  'Comma-separated OAuth scopes GitHub reported for the stored token.';

comment on column public.github_connections.last_synced_at is
  'Last successful repository synchronization.';

comment on column public.github_connections.repo_count is
  'Number of repositories written by the last successful synchronization.';
