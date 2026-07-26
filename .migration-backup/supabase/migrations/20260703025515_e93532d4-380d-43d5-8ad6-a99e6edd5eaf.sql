
-- analysis_items starred flags
ALTER TABLE public.analysis_items
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS starred_at timestamptz;

-- user_preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY,
  email_notifications boolean NOT NULL DEFAULT false,
  schedule_enabled boolean NOT NULL DEFAULT false,
  schedule_frequency text NOT NULL DEFAULT 'weekly',
  last_scheduled_run timestamptz,
  custom_ai_provider text NOT NULL DEFAULT 'lovable',
  custom_ai_key text,
  filter_languages text[] NOT NULL DEFAULT '{}',
  filter_exclude_archived boolean NOT NULL DEFAULT true,
  filter_min_stars integer NOT NULL DEFAULT 0,
  filter_max_repos integer NOT NULL DEFAULT 25,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own preferences" ON public.user_preferences;
CREATE POLICY "own preferences" ON public.user_preferences FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- repo_cache
CREATE TABLE IF NOT EXISTS public.repo_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  github_repo_id bigint NOT NULL,
  full_name text NOT NULL,
  repo_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  readme_text text,
  file_tree text[],
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_id, github_repo_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repo_cache TO authenticated;
GRANT ALL ON public.repo_cache TO service_role;

ALTER TABLE public.repo_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own cache" ON public.repo_cache;
CREATE POLICY "own cache" ON public.repo_cache FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- notification_log
CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  analysis_id uuid,
  type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notifications" ON public.notification_log;
CREATE POLICY "own notifications" ON public.notification_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
