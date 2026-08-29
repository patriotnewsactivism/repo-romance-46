-- Link every bounded completion run to its durable finish-until-target session
-- and add a session-level event stream for resumability and auditability.

alter table public.repo_completion_sessions
  add column if not exists requested_next_steps jsonb not null default '[]'::jsonb,
  add column if not exists item_rank integer;

alter table public.completion_runs
  add column if not exists completion_session_id uuid references public.repo_completion_sessions(id) on delete set null,
  add column if not exists session_iteration integer;

create index if not exists completion_runs_session_idx
on public.completion_runs(user_id, completion_session_id, session_iteration, created_at)
where completion_session_id is not null;

create table if not exists public.repo_completion_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.repo_completion_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  iteration integer,
  kind text not null,
  status text not null default 'info' check (status in ('info','success','warning','error')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.repo_completion_session_events enable row level security;

drop policy if exists repo_completion_session_events_select_own on public.repo_completion_session_events;
create policy repo_completion_session_events_select_own
on public.repo_completion_session_events for select to authenticated
using (auth.uid() = user_id);

drop policy if exists repo_completion_session_events_insert_own on public.repo_completion_session_events;
create policy repo_completion_session_events_insert_own
on public.repo_completion_session_events for insert to authenticated
with check (auth.uid() = user_id);

grant select, insert on public.repo_completion_session_events to authenticated;
grant all on public.repo_completion_session_events to service_role;

create index if not exists repo_completion_session_events_session_idx
on public.repo_completion_session_events(user_id, session_id, created_at);

comment on table public.repo_completion_session_events is
'Auditable state transitions and measured decisions for bounded finish-until-target sessions.';
comment on column public.completion_runs.completion_session_id is
'Links an exact-plan completion run to the durable iterative session that authorized it.';
