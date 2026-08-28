alter table public.repo_watch_settings
  add column if not exists bounded_autonomy_acknowledged_at timestamptz,
  add column if not exists last_event_id text,
  add column if not exists last_sync_at timestamptz;

comment on column public.repo_watch_settings.bounded_autonomy_acknowledged_at is 'Explicit user acknowledgement required before Continuous Repository Mode may create bounded autonomous completion work. Automatic merging remains disabled.';
