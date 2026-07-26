ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;