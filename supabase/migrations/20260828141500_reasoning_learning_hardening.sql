-- Hardening follow-up for Reasoning & Learning OS v3.
-- Adds explicit table privileges, metric-specific learning denominators,
-- analysis-scoped portfolio relationship graphs, provider-neutral external prompts,
-- and restores explicit opt-in for autonomous repair writes.

-- RLS policies do not grant relation privileges by themselves.
grant select, insert, update, delete on public.learning_memories to authenticated;
grant select, insert, update, delete on public.reasoning_traces to authenticated;
grant select, insert, update, delete on public.repo_watch_settings to authenticated;
grant select, insert, update, delete on public.repo_event_queue to authenticated;
grant select, insert, update, delete on public.portfolio_relationships to authenticated;
grant select, insert, update, delete on public.product_readiness_runs to authenticated;
grant select, insert, update, delete on public.repo_completion_sessions to authenticated;

grant all on public.learning_memories to service_role;
grant all on public.reasoning_traces to service_role;
grant all on public.repo_watch_settings to service_role;
grant all on public.repo_event_queue to service_role;
grant all on public.portfolio_relationships to service_role;
grant all on public.product_readiness_runs to service_role;
grant all on public.repo_completion_sessions to service_role;

-- A single generic sample count is not a valid denominator when some observations
-- omit an individual numeric metric. Keep per-metric denominators instead.
alter table public.learning_memories
  add column if not exists outcome_score_samples integer not null default 0 check (outcome_score_samples >= 0),
  add column if not exists completion_delta_samples integer not null default 0 check (completion_delta_samples >= 0),
  add column if not exists readiness_delta_samples integer not null default 0 check (readiness_delta_samples >= 0);

update public.learning_memories
set outcome_score_samples = case when average_outcome_score is null then 0 else greatest(samples, 1) end,
    completion_delta_samples = case when average_completion_delta is null then 0 else greatest(samples, 1) end,
    readiness_delta_samples = case when average_readiness_delta is null then 0 else greatest(samples, 1) end
where outcome_score_samples = 0
  and completion_delta_samples = 0
  and readiness_delta_samples = 0;

-- Relationship graphs belong to a specific analysis snapshot. Do not erase or
-- overwrite unrelated analysis graphs for the same user.
alter table public.portfolio_relationships
  add column if not exists analysis_id uuid references public.analyses(id) on delete cascade;

alter table public.portfolio_relationships
  drop constraint if exists portfolio_relationships_user_id_repo_a_repo_b_relationship_type_key;

drop index if exists portfolio_relationships_analysis_unique_idx;
create unique index portfolio_relationships_analysis_unique_idx
on public.portfolio_relationships(user_id, analysis_id, repo_a, repo_b, relationship_type);

create index if not exists portfolio_relationships_analysis_idx
on public.portfolio_relationships(user_id, analysis_id, confidence desc);

-- A detailed external-agent handoff is an assessment artifact, not an approval
-- to write to the repository. It is persisted so prompts can be audited/regenerated.
create table if not exists public.external_completion_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repo text not null,
  analysis_id uuid references public.analyses(id) on delete set null,
  reasoning_trace_id uuid references public.reasoning_traces(id) on delete set null,
  head_sha text not null,
  default_branch text not null,
  provider_hint text not null default 'provider-neutral',
  prompt_version text not null,
  prompt_md text not null,
  assessment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (provider_hint in ('provider-neutral','codex','claude-code','gemini-cli')),
  check (head_sha ~ '^[0-9a-fA-F]{40}$')
);

alter table public.external_completion_prompts enable row level security;

drop policy if exists external_completion_prompts_select_own on public.external_completion_prompts;
create policy external_completion_prompts_select_own
on public.external_completion_prompts for select to authenticated
using (auth.uid() = user_id);

drop policy if exists external_completion_prompts_insert_own on public.external_completion_prompts;
create policy external_completion_prompts_insert_own
on public.external_completion_prompts for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists external_completion_prompts_delete_own on public.external_completion_prompts;
create policy external_completion_prompts_delete_own
on public.external_completion_prompts for delete to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on public.external_completion_prompts to authenticated;
grant all on public.external_completion_prompts to service_role;

create index if not exists external_completion_prompts_repo_idx
on public.external_completion_prompts(user_id, repo, created_at desc);
create index if not exists external_completion_prompts_analysis_idx
on public.external_completion_prompts(user_id, analysis_id, created_at desc)
where analysis_id is not null;

-- Automatic branch writes must remain an explicit bounded-autonomy choice.
alter table public.completion_runs alter column auto_repair_enabled set default false;

update public.completion_runs
set auto_repair_enabled = false,
    updated_at = now()
where status in ('awaiting_approval','approved','executing','verifying','repairing')
  and coalesce(autonomy_mode, '') <> 'bounded_portfolio';

comment on column public.completion_runs.auto_repair_enabled is
'Automatic CI repair may write additional commits to the run branch and therefore requires explicit bounded-autonomy acknowledgement. It is not enabled by default.';
comment on table public.external_completion_prompts is
'Provider-neutral or provider-adapted current-state completion prompts for optional execution in an external coding agent. These artifacts do not grant repository write approval.';
