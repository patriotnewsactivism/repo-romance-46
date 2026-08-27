-- Align the legacy github_connections table with the current API contract.
-- This migration is additive and preserves existing OAuth connection rows.

ALTER TABLE public.github_connections
  ADD COLUMN IF NOT EXISTS github_id text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.github_connections
SET github_id = github_user_id::text
WHERE github_id IS NULL
  AND github_user_id IS NOT NULL;

UPDATE public.github_connections
SET updated_at = connected_at
WHERE connected_at IS NOT NULL;

COMMENT ON COLUMN public.github_connections.github_id IS
  'GitHub user ID as text, used by the current OAuth connection API.';
COMMENT ON COLUMN public.github_connections.avatar_url IS
  'GitHub profile avatar URL captured when the OAuth token is connected.';
COMMENT ON COLUMN public.github_connections.display_name IS
  'GitHub profile display name captured when the OAuth token is connected.';
COMMENT ON COLUMN public.github_connections.updated_at IS
  'Last time the GitHub OAuth connection was refreshed.';
