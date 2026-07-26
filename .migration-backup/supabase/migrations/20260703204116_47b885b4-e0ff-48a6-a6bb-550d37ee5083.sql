ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS valuation jsonb;
ALTER TABLE public.analysis_items ADD COLUMN IF NOT EXISTS finish_result jsonb;