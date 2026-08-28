alter table public.completion_runs drop constraint if exists completion_runs_status_check;
alter table public.completion_runs add constraint completion_runs_status_check check (status in ('awaiting_approval','approved','executing','verifying','repairing','succeeded','failed','cancelled','stale'));

alter table public.completion_runs add column if not exists auto_repair_enabled boolean not null default false;
alter table public.completion_runs add column if not exists repair_attempts integer not null default 0;
alter table public.completion_runs add column if not exists max_repair_attempts integer not null default 2;
alter table public.completion_runs add column if not exists last_repair_error text;
alter table public.completion_runs add column if not exists repairing_at timestamptz;

alter table public.completion_runs drop constraint if exists completion_runs_repair_attempts_range;
alter table public.completion_runs add constraint completion_runs_repair_attempts_range check (repair_attempts >= 0 and max_repair_attempts between 0 and 5 and repair_attempts <= max_repair_attempts);

create table if not exists public.completion_repair_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.completion_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt integer not null check (attempt > 0 and attempt <= 5),
  status text not null default 'planning' check (status in ('planning','applied','failed','verified')),
  source_head_sha text not null,
  repaired_head_sha text,
  plan_hash text,
  plan jsonb,
  failed_checks jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, attempt)
);

create index if not exists completion_repair_attempts_run_idx on public.completion_repair_attempts(run_id, attempt);
create index if not exists completion_runs_repairing_idx on public.completion_runs(user_id, status, updated_at desc) where status = 'repairing';

alter table public.completion_repair_attempts enable row level security;
grant select, insert, update, delete on public.completion_repair_attempts to authenticated;
grant all on public.completion_repair_attempts to service_role;
drop policy if exists "Users manage their own completion repair attempts" on public.completion_repair_attempts;
create policy "Users manage their own completion repair attempts" on public.completion_repair_attempts for all using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.completion_runs r where r.id = run_id and r.user_id = auth.uid()));

comment on table public.completion_repair_attempts is 'Bounded self-healing CI repair attempts. Automated repairs cannot weaken or modify tests, workflows, security policy files, or lockfiles.';
