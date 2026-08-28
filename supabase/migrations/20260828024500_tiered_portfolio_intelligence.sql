create table if not exists public.portfolio_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','complete','partial_failed','failed','cancelled')),
  total_repos integer not null default 0,
  deep_limit integer not null default 30 check (deep_limit between 1 and 100),
  council_limit integer not null default 8 check (council_limit between 0 and 25 and council_limit <= deep_limit),
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  progress_message text,
  summary jsonb,
  worker_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_intelligence_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.portfolio_intelligence_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  repo text not null,
  initial_rank integer not null,
  initial_finish_first_score numeric not null,
  target_depth text not null check (target_depth in ('deep_source','council')),
  status text not null default 'queued' check (status in ('queued','running','complete','failed','cancelled')),
  refined_score numeric,
  confidence numeric,
  source_head_sha text,
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, repo)
);

alter table public.analyses add column if not exists tiered_intelligence jsonb;
alter table public.analyses add column if not exists tiered_intelligence_updated_at timestamptz;

create index if not exists portfolio_intelligence_runs_analysis_idx on public.portfolio_intelligence_runs(user_id, analysis_id, created_at desc);
create index if not exists portfolio_intelligence_runs_status_idx on public.portfolio_intelligence_runs(status, lease_expires_at);
create index if not exists portfolio_intelligence_items_run_status_idx on public.portfolio_intelligence_items(run_id, status, initial_rank);

alter table public.portfolio_intelligence_runs enable row level security;
alter table public.portfolio_intelligence_items enable row level security;
grant select, insert, update, delete on public.portfolio_intelligence_runs to authenticated;
grant select, insert, update, delete on public.portfolio_intelligence_items to authenticated;
grant all on public.portfolio_intelligence_runs to service_role;
grant all on public.portfolio_intelligence_items to service_role;
drop policy if exists "Users manage their own portfolio intelligence runs" on public.portfolio_intelligence_runs;
create policy "Users manage their own portfolio intelligence runs" on public.portfolio_intelligence_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage their own portfolio intelligence items" on public.portfolio_intelligence_items;
create policy "Users manage their own portfolio intelligence items" on public.portfolio_intelligence_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.portfolio_intelligence_runs r where r.id = run_id and r.user_id = auth.uid()));

comment on table public.portfolio_intelligence_runs is 'Durable tiered intelligence runs: deterministic full-portfolio Tier 1 plus deeper source reasoning only for the most promising candidates.';
