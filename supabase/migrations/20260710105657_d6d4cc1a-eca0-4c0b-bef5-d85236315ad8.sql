
CREATE TABLE public.swarm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'planned',
  autonomy_mode text NOT NULL DEFAULT 'dry_run',
  concurrency int NOT NULL DEFAULT 5,
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.swarm_runs TO authenticated;
GRANT ALL ON public.swarm_runs TO service_role;

ALTER TABLE public.swarm_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own swarm runs"
  ON public.swarm_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX swarm_runs_analysis_id_idx ON public.swarm_runs(analysis_id);
