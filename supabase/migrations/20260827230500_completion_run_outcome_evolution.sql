-- Persist measured autonomous-run outcomes so prompt strategies can be compared
-- against actual repository improvement instead of binary success alone.

ALTER TABLE public.completion_runs
  ADD COLUMN IF NOT EXISTS analysis_id uuid REFERENCES public.analyses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_rank integer,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS baseline_metrics jsonb,
  ADD COLUMN IF NOT EXISTS outcome_metrics jsonb,
  ADD COLUMN IF NOT EXISTS outcome_score numeric(5,1),
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'completion_runs_outcome_score_range'
      AND conrelid = 'public.completion_runs'::regclass
  ) THEN
    ALTER TABLE public.completion_runs
      ADD CONSTRAINT completion_runs_outcome_score_range
      CHECK (outcome_score IS NULL OR outcome_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS completion_runs_analysis_idx
  ON public.completion_runs(user_id, analysis_id, created_at DESC)
  WHERE analysis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS completion_runs_prompt_outcome_idx
  ON public.completion_runs(user_id, prompt_version, outcome_score DESC)
  WHERE prompt_version IS NOT NULL AND outcome_score IS NOT NULL;

COMMENT ON COLUMN public.completion_runs.analysis_id IS
  'Analysis whose Investment Intelligence snapshot supplied the run baseline, when available.';
COMMENT ON COLUMN public.completion_runs.prompt_version IS
  'Prompt/agent strategy version used to generate the exact approved plan.';
COMMENT ON COLUMN public.completion_runs.baseline_metrics IS
  'Normalized before-run completion, readiness, valuation, commercialization, and remaining-work metrics.';
COMMENT ON COLUMN public.completion_runs.outcome_metrics IS
  'Measured post-run metrics and deltas captured after CI verification.';
COMMENT ON COLUMN public.completion_runs.outcome_score IS
  '0-100 measured run score used to compare and evolve autonomous prompt strategies.';
COMMENT ON COLUMN public.completion_runs.evaluated_at IS
  'Timestamp when post-run rescoring and adaptive-learning feedback completed.';
