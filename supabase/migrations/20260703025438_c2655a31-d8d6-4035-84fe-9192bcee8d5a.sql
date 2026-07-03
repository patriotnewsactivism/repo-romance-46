
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS portfolio_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS analyzed_repo_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS tech_stack text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS marketing_tweet text,
  ADD COLUMN IF NOT EXISTS marketing_linkedin text,
  ADD COLUMN IF NOT EXISTS estimated_hours integer;

-- Allow public reads of shared analyses
DROP POLICY IF EXISTS "public shared analyses" ON public.analyses;
CREATE POLICY "public shared analyses" ON public.analyses FOR SELECT
  TO anon, authenticated
  USING (is_public = true AND status = 'complete');

DROP POLICY IF EXISTS "public shared analysis items" ON public.analysis_items;
CREATE POLICY "public shared analysis items" ON public.analysis_items FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.analyses a WHERE a.id = analysis_id AND a.is_public = true AND a.status = 'complete'));

GRANT SELECT ON public.analyses TO anon;
GRANT SELECT ON public.analysis_items TO anon;
