-- Durable RepoFinisher execution model.
-- Approval is bound to both the exact repository base commit and canonical plan hash.

CREATE TABLE IF NOT EXISTS public.completion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo text NOT NULL,
  default_branch text NOT NULL,
  base_sha text NOT NULL,
  plan_hash text NOT NULL,
  plan jsonb NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN (
      'awaiting_approval',
      'approved',
      'executing',
      'verifying',
      'succeeded',
      'failed',
      'cancelled',
      'stale'
    )),
  approved_hash text,
  approved_at timestamptz,
  branch_name text,
  head_sha text,
  pr_number integer,
  pr_url text,
  ci_status text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT completion_runs_plan_hash_format CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT completion_runs_approved_hash_format CHECK (approved_hash IS NULL OR approved_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS public.completion_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.completion_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'running',
      'committed',
      'verifying',
      'passed',
      'failed',
      'skipped',
      'cancelled'
    )),
  scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS public.completion_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.completion_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_sha text NOT NULL,
  plan_hash text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT completion_approvals_plan_hash_format CHECK (plan_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS public.completion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.completion_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'info'
    CHECK (status IN ('info', 'success', 'warning', 'error')),
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS completion_runs_user_created_idx
  ON public.completion_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS completion_runs_repo_status_idx
  ON public.completion_runs(user_id, repo, status, created_at DESC);
CREATE INDEX IF NOT EXISTS completion_steps_run_idx
  ON public.completion_steps(run_id, ordinal);
CREATE INDEX IF NOT EXISTS completion_approvals_run_idx
  ON public.completion_approvals(run_id, approved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS completion_approvals_one_active_idx
  ON public.completion_approvals(run_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS completion_events_run_created_idx
  ON public.completion_events(run_id, created_at ASC);

ALTER TABLE public.completion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.completion_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.completion_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.completion_approvals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.completion_events TO authenticated;

GRANT ALL ON public.completion_runs TO service_role;
GRANT ALL ON public.completion_steps TO service_role;
GRANT ALL ON public.completion_approvals TO service_role;
GRANT ALL ON public.completion_events TO service_role;

DROP POLICY IF EXISTS "Users manage their own completion runs" ON public.completion_runs;
CREATE POLICY "Users manage their own completion runs"
  ON public.completion_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own completion steps" ON public.completion_steps;
CREATE POLICY "Users manage their own completion steps"
  ON public.completion_steps FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.completion_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users manage their own completion approvals" ON public.completion_approvals;
CREATE POLICY "Users manage their own completion approvals"
  ON public.completion_approvals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.completion_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users manage their own completion events" ON public.completion_events;
CREATE POLICY "Users manage their own completion events"
  ON public.completion_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.completion_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.completion_runs IS
  'Durable RepoFinisher runs. Approval is bound to base_sha + plan_hash and execution fails closed if either changes.';
COMMENT ON TABLE public.completion_steps IS
  'Ordered, resumable execution steps for a completion run.';
COMMENT ON TABLE public.completion_approvals IS
  'Immutable approval records binding a user decision to an exact plan hash and repository base SHA.';
COMMENT ON TABLE public.completion_events IS
  'Append-only-style audit timeline for RepoFinisher run lifecycle and verification events.';
