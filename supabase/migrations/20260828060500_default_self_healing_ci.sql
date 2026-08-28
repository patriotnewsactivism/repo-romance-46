alter table public.completion_runs alter column auto_repair_enabled set default true;
alter table public.completion_runs alter column max_repair_attempts set default 3;

update public.completion_runs
set auto_repair_enabled = true,
    max_repair_attempts = greatest(max_repair_attempts, 3),
    updated_at = now()
where status in ('approved','executing','verifying','repairing')
  and repair_attempts < 3;

comment on column public.completion_runs.auto_repair_enabled is 'Self-healing is enabled by default for new RepoFinisher runs; repair safety rules still prohibit weakening tests, CI, security controls, or approval boundaries.';
