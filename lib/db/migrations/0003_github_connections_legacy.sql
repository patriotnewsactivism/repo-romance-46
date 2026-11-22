-- The legacy github_connections table carried `github_user_id` and
-- `connected_at`; later migrations backfill the current API columns from them.
-- Added separately so databases that already applied 0002 pick them up.
alter table public.github_connections
  add column if not exists github_user_id text,
  add column if not exists connected_at timestamptz;
