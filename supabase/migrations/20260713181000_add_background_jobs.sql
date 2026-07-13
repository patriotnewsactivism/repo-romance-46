-- Background job queue for autonomous processing.
-- Jobs are queued by users or the reasoning engine, then processed by the cron runner.

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo text,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'complete', 'failed')),
  priority integer NOT NULL DEFAULT 50
    CHECK (priority >= 0 AND priority <= 100),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_step text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.background_jobs TO authenticated;
GRANT ALL ON public.background_jobs TO service_role;

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own background jobs"
  ON public.background_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can manage all jobs (for cron runner)
CREATE POLICY "Service role manages all jobs"
  ON public.background_jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for efficient queue processing
CREATE INDEX background_jobs_queue_idx
  ON public.background_jobs(user_id, status, priority DESC)
  WHERE status = 'queued';

CREATE INDEX background_jobs_status_idx
  ON public.background_jobs(status, created_at);

CREATE INDEX background_jobs_user_history_idx
  ON public.background_jobs(user_id, completed_at DESC)
  WHERE status IN ('complete', 'failed');

COMMENT ON TABLE public.background_jobs IS 'Queue for autonomous background processing — analysis, finishing, dependency audits, etc.';
