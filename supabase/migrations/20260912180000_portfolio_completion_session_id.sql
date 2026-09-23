-- Finish Portfolio items can own a finish-until-target session instead of a
-- one-shot completion run. The existing completion_run_id remains for the
-- latest iteration PR/CI evidence.

alter table public.portfolio_completion_items
  add column if not exists completion_session_id uuid references public.repo_completion_sessions(id) on delete set null;

create index if not exists portfolio_completion_items_session_idx
  on public.portfolio_completion_items(user_id, completion_session_id)
  where completion_session_id is not null;

comment on column public.portfolio_completion_items.completion_session_id is
'Finish-until-target session launched by Finish Portfolio for this repository. Automatic merge remains disabled.';
