-- Repository Investment Intelligence + outcome-driven adaptive learning.
-- Safe to apply to databases that already contain the legacy learning tables.

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS investment_intelligence jsonb,
  ADD COLUMN IF NOT EXISTS investment_intelligence_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.repo_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo text NOT NULL,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  patterns_detected text[] NOT NULL DEFAULT '{}',
  last_analysis jsonb,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo)
);

CREATE TABLE IF NOT EXISTS public.cross_repo_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  occurrences jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  recommendation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern)
);

CREATE INDEX IF NOT EXISTS repo_learnings_user_repo_idx ON public.repo_learnings(user_id, repo);
CREATE INDEX IF NOT EXISTS cross_repo_patterns_user_idx ON public.cross_repo_patterns(user_id);
CREATE INDEX IF NOT EXISTS cross_repo_patterns_confidence_idx ON public.cross_repo_patterns(user_id, confidence DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repo_learnings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cross_repo_patterns TO authenticated;
GRANT ALL ON public.repo_learnings TO service_role;
GRANT ALL ON public.cross_repo_patterns TO service_role;

ALTER TABLE public.repo_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cross_repo_patterns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'repo_learnings' AND policyname = 'Users manage their own repo learnings'
  ) THEN
    CREATE POLICY "Users manage their own repo learnings"
      ON public.repo_learnings FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cross_repo_patterns' AND policyname = 'Users manage their own cross-repo patterns'
  ) THEN
    CREATE POLICY "Users manage their own cross-repo patterns"
      ON public.cross_repo_patterns FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Keep only the newest N learning events so continuous learning cannot grow a
-- single repo row without bound.
CREATE OR REPLACE FUNCTION public.jsonb_array_append_capped(existing jsonb, entry jsonb, max_items integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
  FROM (
    SELECT value, ord
    FROM jsonb_array_elements(COALESCE(existing, '[]'::jsonb) || jsonb_build_array(entry)) WITH ORDINALITY AS e(value, ord)
    ORDER BY ord DESC
    LIMIT GREATEST(max_items, 1)
  ) recent;
$$;

-- Every verified completion outcome becomes memory automatically. The API then
-- injects these successes/failures into future agent prompts, closing the loop
-- without relying on a browser session staying alive.
CREATE OR REPLACE FUNCTION public.capture_completion_run_learning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  learning_entry jsonb;
  outcome_text text;
BEGIN
  IF NEW.status NOT IN ('succeeded', 'failed', 'stale') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  outcome_text := CASE
    WHEN NEW.status = 'succeeded' THEN 'success'
    WHEN NEW.status = 'stale' THEN 'partial'
    ELSE 'failure'
  END;

  learning_entry := jsonb_build_object(
    'action', 'completion_run',
    'outcome', outcome_text,
    'duration_ms', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.updated_at - NEW.created_at)) * 1000))::bigint,
    'details', CASE
      WHEN NEW.status = 'succeeded' THEN 'Approved autonomous completion plan passed repository verification.'
      WHEN NEW.status = 'stale' THEN 'Repository base changed after planning; stale execution was correctly blocked.'
      ELSE COALESCE(NEW.error, 'Completion run failed verification or execution.')
    END,
    'files_affected', COALESCE(
      (SELECT jsonb_agg(change->>'path') FROM jsonb_array_elements(COALESCE(NEW.plan->'changes', '[]'::jsonb)) change),
      '[]'::jsonb
    ),
    'error_message', NEW.error,
    'fix_pattern', 'completion-run',
    'prompt_version', 'adaptive-agent-loop-v1',
    'metadata', jsonb_build_object(
      'run_id', NEW.id,
      'plan_hash', NEW.plan_hash,
      'pr_number', NEW.pr_number,
      'ci_status', NEW.ci_status,
      'head_sha', NEW.head_sha
    ),
    'timestamp', NEW.updated_at
  );

  INSERT INTO public.repo_learnings (
    user_id, repo, history, patterns_detected, analyzed_at, updated_at
  ) VALUES (
    NEW.user_id,
    NEW.repo,
    jsonb_build_array(learning_entry),
    ARRAY['completion-run']::text[],
    NEW.updated_at,
    NEW.updated_at
  )
  ON CONFLICT (user_id, repo) DO UPDATE SET
    history = public.jsonb_array_append_capped(public.repo_learnings.history, learning_entry, 100),
    patterns_detected = CASE
      WHEN 'completion-run' = ANY(public.repo_learnings.patterns_detected)
        THEN public.repo_learnings.patterns_detected
      ELSE array_append(public.repo_learnings.patterns_detected, 'completion-run')
    END,
    analyzed_at = NEW.updated_at,
    updated_at = NEW.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS completion_runs_capture_learning ON public.completion_runs;
CREATE TRIGGER completion_runs_capture_learning
AFTER UPDATE OF status ON public.completion_runs
FOR EACH ROW
EXECUTE FUNCTION public.capture_completion_run_learning();

COMMENT ON COLUMN public.analyses.investment_intelligence IS
  'Evidence-classified Repo Investment Intelligence snapshot including finish-first portfolio ranking.';
COMMENT ON FUNCTION public.capture_completion_run_learning() IS
  'Turns terminal completion-run outcomes into bounded adaptive memory for future autonomous prompts.';
