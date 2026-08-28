-- RepoFinisher Reasoning & Learning OS v3
-- Durable, queryable memory + reasoning traces + continuous repository events
-- + portfolio relationship graph + product-readiness evidence + iterative sessions.

create table if not exists public.learning_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null default '*',
  scope text not null default 'repo' check (scope in ('repo', 'cross_repo', 'portfolio')),
  category text not null check (category in ('planning', 'ci_repair', 'deployment', 'security', 'product_flow', 'database', 'valuation', 'architecture', 'tooling', 'failure_mode')),
  memory_key text not null,
  observation text not null,
  recommendation text not null,
  confidence numeric(5,2) not null default 50 check (confidence between 0 and 100),
  samples integer not null default 1 check (samples >= 0),
  successes integer not null default 0 check (successes >= 0),
  failures integer not null default 0 check (failures >= 0),
  average_outcome_score numeric(6,2),
  average_completion_delta numeric(7,2),
  average_readiness_delta numeric(7,2),
  evidence jsonb not null default '[]'::jsonb,
  last_outcome text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, repo, scope, category, memory_key)
);

create table if not exists public.reasoning_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  analysis_id uuid references public.analyses(id) on delete set null,
  completion_run_id uuid references public.completion_runs(id) on delete set null,
  portfolio_run_id uuid references public.portfolio_completion_runs(id) on delete set null,
  mode text not null check (mode in ('plan', 'repair', 'replan', 'security', 'readiness', 'continuous_event', 'portfolio_graph')),
  stage text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'partial')),
  prompt_version text,
  strategy_arm text,
  specialists jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  critiques jsonb not null default '[]'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_watch_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  enabled boolean not null default true,
  event_types text[] not null default array['push','pull_request','workflow_run','release','repository_vulnerability_alert','dependabot_alert']::text[],
  auto_analyze boolean not null default true,
  auto_finish_mode text not null default 'recommend' check (auto_finish_mode in ('off', 'recommend', 'bounded')),
  risk_threshold integer not null default 35 check (risk_threshold between 0 and 100),
  max_estimated_cost_usd numeric(12,2),
  min_rescore_interval_minutes integer not null default 30 check (min_rescore_interval_minutes between 5 and 10080),
  last_event_at timestamptz,
  last_analysis_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, repo)
);

create table if not exists public.repo_event_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  event_type text not null,
  external_id text,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'ignored')),
  attempts integer not null default 0,
  error text,
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table if not exists public.portfolio_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo_a text not null,
  repo_b text not null,
  relationship_type text not null check (relationship_type in ('duplicate', 'shared_ip', 'dependency', 'successor', 'frontend_backend', 'worker_service', 'merge_candidate', 'archive_candidate')),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]'::jsonb,
  recommendation text not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (repo_a <> repo_b),
  unique (user_id, repo_a, repo_b, relationship_type)
);

create table if not exists public.product_readiness_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  completion_run_id uuid references public.completion_runs(id) on delete set null,
  head_sha text not null,
  suite_version text not null default 'readiness-v1',
  status text not null check (status in ('pending', 'passed', 'failed', 'partial')),
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  checks jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.repo_completion_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  analysis_id uuid references public.analyses(id) on delete set null,
  portfolio_run_id uuid references public.portfolio_completion_runs(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'succeeded', 'blocked', 'budget_exhausted', 'cancelled')),
  target_completion_pct integer not null default 95 check (target_completion_pct between 50 and 100),
  target_readiness_pct integer not null default 90 check (target_readiness_pct between 50 and 100),
  max_iterations integer not null default 5 check (max_iterations between 1 and 12),
  iteration_count integer not null default 0,
  no_progress_count integer not null default 0,
  last_completion_pct numeric(5,2),
  last_readiness_pct numeric(5,2),
  last_outcome_score numeric(5,2),
  max_estimated_cost_usd numeric(12,2),
  estimated_cost_used_usd numeric(12,2) not null default 0,
  last_completion_run_id uuid references public.completion_runs(id) on delete set null,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.learning_memories enable row level security;
alter table public.reasoning_traces enable row level security;
alter table public.repo_watch_settings enable row level security;
alter table public.repo_event_queue enable row level security;
alter table public.portfolio_relationships enable row level security;
alter table public.product_readiness_runs enable row level security;
alter table public.repo_completion_sessions enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'learning_memories',
    'reasoning_traces',
    'repo_watch_settings',
    'repo_event_queue',
    'portfolio_relationships',
    'product_readiness_runs',
    'repo_completion_sessions'
  ] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_own', tbl);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', tbl || '_select_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_own', tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)', tbl || '_insert_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_own', tbl);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', tbl || '_update_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_own', tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)', tbl || '_delete_own', tbl);
  end loop;
end $$;

create index if not exists learning_memories_repo_category_idx on public.learning_memories(user_id, repo, category, confidence desc);
create index if not exists learning_memories_cross_repo_idx on public.learning_memories(user_id, scope, category, confidence desc) where repo = '*';
create index if not exists reasoning_traces_repo_idx on public.reasoning_traces(user_id, repo, created_at desc);
create index if not exists reasoning_traces_run_idx on public.reasoning_traces(user_id, completion_run_id, created_at desc) where completion_run_id is not null;
create index if not exists repo_event_queue_work_idx on public.repo_event_queue(user_id, status, available_at, created_at);
create index if not exists portfolio_relationships_repo_a_idx on public.portfolio_relationships(user_id, repo_a, confidence desc);
create index if not exists portfolio_relationships_repo_b_idx on public.portfolio_relationships(user_id, repo_b, confidence desc);
create index if not exists product_readiness_runs_repo_idx on public.product_readiness_runs(user_id, repo, created_at desc);
create index if not exists repo_completion_sessions_active_idx on public.repo_completion_sessions(user_id, status, updated_at desc);

comment on table public.learning_memories is 'Queryable operational memory distilled from measured RepoFinisher outcomes; strategy guidance may use it but immutable safety policy cannot be changed by it.';
comment on table public.reasoning_traces is 'Auditable multi-stage reasoning evidence, hypotheses, critiques, selected specialists, and final decisions for autonomous repository operations.';
comment on table public.repo_event_queue is 'Durable event queue for Continuous Repository Mode. Webhook or scheduled ingestion can enqueue idempotent repository change events.';
comment on table public.repo_completion_sessions is 'Multi-iteration completion objective with explicit targets, budgets, no-progress stops, and per-repository rollback boundaries.';
