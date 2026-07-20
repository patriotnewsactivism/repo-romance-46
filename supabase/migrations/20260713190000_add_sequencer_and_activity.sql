-- Step Sequencer runs â tracks multi-step completion pipelines.
-- Each run contains a plan with steps, their status, CI results, and outcomes.

CREATE TABLE IF NOT EXISTS public.sequencer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo text NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'paused', 'completed', 'failed', 'stopped_on_failure')),
  steps_completed integer NOT NULL DEFAULT 0,
  steps_failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sequencer_runs TO authenticated;
GRANT ALL ON public.sequencer_runs TO service_role;

ALTER TABLE public.sequencer_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sequencer runs"
  ON public.sequencer_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX sequencer_runs_user_idx ON public.sequencer_runs(user_id, created_at DESC);
CREATE INDEX sequencer_runs_repo_idx ON public.sequencer_runs(repo, status);

-- Activity feed â unified timeline of all actions across the system.
-- Every operation (analysis, finish, sequencer step, CI check, learning) gets logged here.

CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  repo text,
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'info'
    CHECK (status IN ('info', 'success', 'warning', 'error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_events TO authenticated;
GRANT ALL ON public.activity_events TO service_role;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own activity"
  ON public.activity_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX activity_events_user_idx ON public.activity_events(user_id, created_at DESC);
CREATE INDEX activity_events_repo_idx ON public.activity_events(repo, created_at DESC);

COMMENT ON TABLE public.sequencer_runs IS 'Step-by-step completion pipeline runs â each with a plan, step statuses, and CI results.';
COMMENT ON TABLE public.activity_events IS 'Unified activity feed â timeline of all system actions per user.';
