-- Add profile/prompt/critique columns that the analysis worker writes to but
-- no prior migration created. The code already handles their absence with
-- try/catch fallbacks, but without them the developer profile, custom
-- system prompt, strategy summary, and critique are silently lost on every
-- analysis run — stored only inside the portfolio_stats JSONB blob as a
-- _strategy sub-object instead of being first-class queryable columns.

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS developer_profile jsonb,
  ADD COLUMN IF NOT EXISTS generated_system_prompt text,
  ADD COLUMN IF NOT EXISTS strategy_summary text,
  ADD COLUMN IF NOT EXISTS critique_md text;

COMMENT ON COLUMN public.analyses.developer_profile IS
  'AI-generated profile of the developer portfolio — domain clusters, skill assessment, and profile narrative.';
COMMENT ON COLUMN public.analyses.generated_system_prompt IS
  'Context-aware custom system prompt generated from the portfolio profile, used for AI batch analysis.';
COMMENT ON COLUMN public.analyses.strategy_summary IS
  'Human-readable summary of the analysis strategy derived from the developer profile.';
COMMENT ON COLUMN public.analyses.critique_md IS
  'Self-critique pass output — gaps identified, made-specific fixes, and added synergies.';
