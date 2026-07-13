-- Learning & Deep Analysis tables
-- Supports persistent memory per repo and cross-repo pattern detection.

-- 1. repo_learnings — per-repo history of what worked, what broke, analysis results
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repo_learnings TO authenticated;
GRANT ALL ON public.repo_learnings TO service_role;

ALTER TABLE public.repo_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own repo learnings"
  ON public.repo_learnings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX repo_learnings_user_repo_idx ON public.repo_learnings(user_id, repo);

-- 2. cross_repo_patterns — recurring patterns across multiple repos
CREATE TABLE IF NOT EXISTS public.cross_repo_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  occurrences jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cross_repo_patterns TO authenticated;
GRANT ALL ON public.cross_repo_patterns TO service_role;

ALTER TABLE public.cross_repo_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own cross-repo patterns"
  ON public.cross_repo_patterns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX cross_repo_patterns_user_idx ON public.cross_repo_patterns(user_id);
CREATE INDEX cross_repo_patterns_confidence_idx ON public.cross_repo_patterns(confidence DESC);

-- 3. Add deep_analysis column to analysis_items for per-repo deep analysis results
ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS deep_analysis jsonb;

COMMENT ON TABLE public.repo_learnings IS 'Per-repo persistent memory — logs successes, failures, patterns across finish attempts';
COMMENT ON TABLE public.cross_repo_patterns IS 'Cross-repo pattern log — recurring fix patterns with success/failure tracking';
