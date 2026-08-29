-- Durable runtime state for finish-until-target sessions.
-- A session may append multiple exact-plan commits to one RepoFinisher branch/PR,
-- but automatic merge remains disabled.

alter table public.repo_completion_sessions
  add column if not exists autonomy_acknowledged_at timestamptz,
  add column if not exists branch_name text,
  add column if not exists pr_number integer,
  add column if not exists pr_url text,
  add column if not exists current_head_sha text,
  add column if not exists phase text not null default 'queued',
  add column if not exists worker_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists last_progress_at timestamptz,
  add column if not exists last_error text,
  add column if not exists max_no_progress_iterations integer not null default 2 check (max_no_progress_iterations between 1 and 5);

alter table public.repo_completion_sessions
  drop constraint if exists repo_completion_sessions_phase_check;
alter table public.repo_completion_sessions
  add constraint repo_completion_sessions_phase_check
  check (phase in ('queued','planning','executing','verifying','repairing','rescoring','replanning','complete','blocked'));

alter table public.repo_completion_sessions
  drop constraint if exists repo_completion_sessions_current_head_sha_check;
alter table public.repo_completion_sessions
  add constraint repo_completion_sessions_current_head_sha_check
  check (current_head_sha is null or current_head_sha ~ '^[0-9a-fA-F]{40}$');

create index if not exists repo_completion_sessions_worker_idx
on public.repo_completion_sessions(user_id, status, lease_expires_at, updated_at desc);

comment on table public.repo_completion_sessions is
'Durable bounded-autonomy finish-until-target controller. Iterations preserve one repository branch/PR and exact per-iteration plan hashes; automatic merge is never implied.';
comment on column public.repo_completion_sessions.autonomy_acknowledged_at is
'Explicit acknowledgement authorizing bounded iterative branch writes for this session. Does not authorize automatic merge.';
comment on column public.repo_completion_sessions.current_head_sha is
'Current RepoFinisher branch head used as the exact base for the next iteration.';
