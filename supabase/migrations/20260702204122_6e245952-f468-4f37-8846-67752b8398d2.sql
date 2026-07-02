
-- github_connections
CREATE TABLE public.github_connections (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_login TEXT NOT NULL,
  access_token TEXT NOT NULL,
  scope TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_connections TO authenticated;
GRANT ALL ON public.github_connections TO service_role;
ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own connection" ON public.github_connections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- analyses
CREATE TABLE public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  repo_count INTEGER NOT NULL DEFAULT 0,
  summary_md TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analyses_user_id_idx ON public.analyses(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analyses" ON public.analyses FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- analysis_items
CREATE TABLE public.analysis_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  repos JSONB NOT NULL DEFAULT '[]'::jsonb,
  pitch TEXT NOT NULL,
  effort INTEGER NOT NULL DEFAULT 3,
  market_potential INTEGER NOT NULL DEFAULT 3,
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analysis_items_analysis_id_idx ON public.analysis_items(analysis_id, rank);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_items TO authenticated;
GRANT ALL ON public.analysis_items TO service_role;
ALTER TABLE public.analysis_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own items" ON public.analysis_items FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
