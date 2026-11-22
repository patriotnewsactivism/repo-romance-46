-- Ported from supabase/migrations/20260828022000_portfolio_completion_runs.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

-- Bounded one-click portfolio completion orchestration.

create table if not exists public.portfolio_completion_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users (id) on delete cascade,
  analysis_id uuid references public.analyses(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','verifying','succeeded','partial_failed','failed','cancelled')),
  selection_limit integer not null check (selection_limit between 1 and 500),
  concurrency integer not null default 2 check (concurrency between 1 and 5),
  max_estimated_hours numeric,
  max_estimated_cost_usd numeric,
  stop_on_failure boolean not null default false,
  auto_execute boolean not null default true,
  autonomy_acknowledged_at timestamptz not null,
  requested_count integer not null default 0,
  planned_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  verifying_count integer not null default 0,
  skipped_count integer not null default 0,
  estimated_hours_selected numeric not null default 0,
  estimated_cost_selected numeric not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_estimated_hours is null or max_estimated_hours > 0),
  check (max_estimated_cost_usd is null or max_estimated_cost_usd > 0)
);


create table if not exists public.portfolio_completion_items (
  id uuid primary key default gen_random_uuid(),
  portfolio_run_id uuid not null references public.portfolio_completion_runs(id) on delete cascade,
  user_id uuid not null references app_users (id) on delete cascade,
  repo text not null,
  rank integer not null check (rank > 0),
  status text not null default 'queued' check (status in ('queued','planning','executing','verifying','succeeded','failed','skipped','cancelled')),
  estimated_hours numeric,
  estimated_cost_usd numeric,
  next_steps jsonb not null default '[]'::jsonb,
  completion_run_id uuid references public.completion_runs(id) on delete set null,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_run_id, repo)
);


alter table public.completion_runs
  add column if not exists portfolio_run_id uuid references public.portfolio_completion_runs(id) on delete set null,
  add column if not exists autonomy_mode text not null default 'exact_plan',
  add column if not exists approval_policy jsonb not null default '{}'::jsonb;


alter table public.completion_approvals
  add column if not exists approval_mode text not null default 'exact_plan';


do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'completion_runs_autonomy_mode_check'
  ) then
    alter table public.completion_runs add constraint completion_runs_autonomy_mode_check
      check (autonomy_mode in ('exact_plan','bounded_portfolio'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'completion_approvals_mode_check'
  ) then
    alter table public.completion_approvals add constraint completion_approvals_mode_check
      check (approval_mode in ('exact_plan','bounded_portfolio'));
  end if;
end $$;


create index if not exists portfolio_completion_runs_user_created_idx
  on public.portfolio_completion_runs(user_id, created_at desc);

create index if not exists portfolio_completion_runs_status_idx
  on public.portfolio_completion_runs(user_id, status, updated_at desc);

create index if not exists portfolio_completion_items_run_status_idx
  on public.portfolio_completion_items(portfolio_run_id, status, rank);

create index if not exists completion_runs_portfolio_run_idx
  on public.completion_runs(portfolio_run_id, created_at);


comment on table public.portfolio_completion_runs is
  'Durable bounded-autonomy portfolio completion runs initiated by one explicit user action.';

comment on table public.portfolio_completion_items is
  'Per-repository work items within a bounded portfolio completion run.';

comment on column public.completion_runs.autonomy_mode is
  'exact_plan requires plan-hash approval; bounded_portfolio is authorized by an explicit portfolio-run policy and still creates draft PRs only.';
