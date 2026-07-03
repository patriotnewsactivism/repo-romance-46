ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS market_analysis jsonb,
  ADD COLUMN IF NOT EXISTS valuation jsonb,
  ADD COLUMN IF NOT EXISTS vibe_spec jsonb,
  ADD COLUMN IF NOT EXISTS combine_result jsonb,
  ADD COLUMN IF NOT EXISTS finish_history jsonb,
  ADD COLUMN IF NOT EXISTS iteration_count integer NOT NULL DEFAULT 0;