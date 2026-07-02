-- 1. Starred recommendations (track which ones user is acting on)
ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS starred_at TIMESTAMPTZ;

-- 2. User preferences table (for scheduled re-analysis, email notifications, BYOK)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN NOT NULL DEFAULT false,
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  schedule_frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule_frequency IN ('weekly', 'monthly')),
  last_scheduled_run TIMESTAMPTZ,
  -- BYOK: Bring Your Own AI Key
  custom_ai_provider TEXT DEFAULT 'lovable',
  custom_ai_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on user_preferences
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own preferences"
  ON public.user_preferences
  FOR ALL USING (user_id = auth.uid());

-- 3. Analysis filter preferences (topics/languages to include or exclude)
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS filter_languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS filter_exclude_archived BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS filter_min_stars INTEGER DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS analysis_items_starred_idx
  ON public.analysis_items(user_id, is_starred) WHERE is_starred = true;
CREATE INDEX IF NOT EXISTS user_preferences_schedule_idx
  ON public.user_preferences(schedule_enabled, schedule_frequency)
  WHERE schedule_enabled = true;
