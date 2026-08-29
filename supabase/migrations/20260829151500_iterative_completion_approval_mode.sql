-- Explicitly model finish-until-target as a bounded-autonomy approval mode.
-- It authorizes iterative commits only inside the session's declared limits;
-- it never authorizes automatic merge.

alter table public.completion_runs
  drop constraint if exists completion_runs_autonomy_mode_check;
alter table public.completion_runs
  add constraint completion_runs_autonomy_mode_check
  check (autonomy_mode in ('exact_plan','bounded_portfolio','bounded_completion_session'));

alter table public.completion_approvals
  drop constraint if exists completion_approvals_mode_check;
alter table public.completion_approvals
  add constraint completion_approvals_mode_check
  check (approval_mode in ('exact_plan','bounded_portfolio','bounded_completion_session'));

comment on column public.completion_runs.autonomy_mode is
'exact_plan requires exact plan-hash approval; bounded_portfolio and bounded_completion_session require explicit higher-autonomy acknowledgement with hard limits. All modes keep automatic merge disabled unless separately and explicitly changed.';
