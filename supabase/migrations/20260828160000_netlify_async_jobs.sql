-- Durable platform-neutral async jobs. Netlify Background Functions consume these
-- so long reasoning/analysis work is never coupled to the 60s synchronous limit.
create table if not exists public.async_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('agentic_preview','analysis','ci_repair','portfolio_run')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.async_jobs enable row level security;

drop policy if exists async_jobs_select_own on public.async_jobs;
create policy async_jobs_select_own on public.async_jobs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists async_jobs_insert_own on public.async_jobs;
create policy async_jobs_insert_own on public.async_jobs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists async_jobs_update_own on public.async_jobs;
create policy async_jobs_update_own on public.async_jobs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists async_jobs_delete_own on public.async_jobs;
create policy async_jobs_delete_own on public.async_jobs
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists async_jobs_user_created_idx on public.async_jobs(user_id, created_at desc);
create index if not exists async_jobs_queue_idx on public.async_jobs(status, created_at) where status in ('queued','running');

comment on table public.async_jobs is 'Durable background work queue used by hosting adapters such as Netlify Background Functions. Job payloads never contain provider API keys or user bearer tokens.';
