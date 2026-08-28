-- Keep the reasoning/learning OS efficient under large portfolio workloads.
-- The ownership predicates are unchanged; wrapping auth.uid() in SELECT lets
-- Postgres evaluate it once per statement instead of once per row.

do $$
declare
  target_table text;
  policy_row record;
begin
  foreach target_table in array array[
    'prompt_strategy_experiments',
    'learning_memories',
    'reasoning_traces',
    'repo_watch_settings',
    'repo_event_queue',
    'portfolio_relationships',
    'product_readiness_runs',
    'repo_completion_sessions',
    'external_completion_prompts'
  ]
  loop
    for policy_row in
      select policyname, cmd
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      case policy_row.cmd
        when 'SELECT', 'DELETE' then
          execute format(
            'alter policy %I on public.%I using ((select auth.uid()) = user_id)',
            policy_row.policyname,
            target_table
          );
        when 'INSERT' then
          execute format(
            'alter policy %I on public.%I with check ((select auth.uid()) = user_id)',
            policy_row.policyname,
            target_table
          );
        when 'UPDATE' then
          execute format(
            'alter policy %I on public.%I using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
            policy_row.policyname,
            target_table
          );
      end case;
    end loop;
  end loop;
end
$$;

create index if not exists reasoning_traces_analysis_id_idx
  on public.reasoning_traces (analysis_id);
create index if not exists reasoning_traces_completion_run_id_idx
  on public.reasoning_traces (completion_run_id);
create index if not exists reasoning_traces_portfolio_run_id_idx
  on public.reasoning_traces (portfolio_run_id);

create index if not exists portfolio_relationships_analysis_id_idx
  on public.portfolio_relationships (analysis_id);

create index if not exists product_readiness_runs_completion_run_id_idx
  on public.product_readiness_runs (completion_run_id);

create index if not exists repo_completion_sessions_analysis_id_idx
  on public.repo_completion_sessions (analysis_id);
create index if not exists repo_completion_sessions_portfolio_run_id_idx
  on public.repo_completion_sessions (portfolio_run_id);
create index if not exists repo_completion_sessions_last_completion_run_id_idx
  on public.repo_completion_sessions (last_completion_run_id);

create index if not exists external_completion_prompts_analysis_id_idx
  on public.external_completion_prompts (analysis_id);
create index if not exists external_completion_prompts_reasoning_trace_id_idx
  on public.external_completion_prompts (reasoning_trace_id);
