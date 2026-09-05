-- Action plan generation was a single synchronous LLM call inside the HTTP
-- request handler (POST /analysis/:id/action-plan) — on a slow model/big
-- recommendation set this exceeds the platform's gateway timeout and the
-- client gets a bare 504 with no result and no way to recover except retry.
--
-- Moves generation to the same in-process background-job + status-polling
-- pattern already used for the main analysis run (see startAnalysisJob /
-- runInBackground in analysis.ts): the POST returns immediately, a
-- background task does the LLM call, and the result/error land in these
-- columns for the client to poll via GET /analysis/:id/action-plan.
alter table public.analyses add column if not exists action_plan jsonb;
alter table public.analyses add column if not exists action_plan_status text;
alter table public.analyses add column if not exists action_plan_error text;
alter table public.analyses add column if not exists action_plan_updated_at timestamptz;
