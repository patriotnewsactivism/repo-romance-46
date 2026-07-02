-- Add tech stack detection and marketing copy to analysis items
ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS tech_stack JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_tweet TEXT,
  ADD COLUMN IF NOT EXISTS marketing_linkedin TEXT,
  ADD COLUMN IF NOT EXISTS estimated_hours INTEGER;

-- Add portfolio stats to analyses
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS portfolio_stats JSONB DEFAULT '{}'::jsonb;

-- Add public sharing support
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_slug TEXT UNIQUE;

-- Index for public lookups
CREATE INDEX IF NOT EXISTS analyses_share_slug_idx ON public.analyses(share_slug) WHERE share_slug IS NOT NULL;

-- Allow public read access to shared analyses
CREATE POLICY "public shared analyses" ON public.analyses
  FOR SELECT USING (is_public = true AND status = 'complete');
CREATE POLICY "public shared items" ON public.analysis_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_items.analysis_id
      AND analyses.is_public = true
      AND analyses.status = 'complete'
    )
  );
