-- Ported from supabase/migrations/20260924080000_add_qwen_ai_provider.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

-- Allow 'qwen' wherever an AI provider identifier is validated.
--
-- Qwen became selectable in Settings and accepted by the preferences API, but
-- the database still rejected it in five places, so every save failed and the
-- provider was unusable end to end:
--   1. user_preferences.custom_ai_provider check constraint
--   2. ai_provider_credentials.provider check constraint
--   3-5. the provider-scoped Vault store/read/delete RPCs
--
-- Forward-only and safe for existing data: both constraints are widened, never
-- narrowed, so no stored row can be invalidated. The RPC bodies are unchanged
-- apart from the allowlist, and keep their SECURITY DEFINER, search_path,
-- caller check, and least-privilege grants.

alter table public.user_preferences drop constraint if exists user_preferences_custom_ai_provider_check;

alter table public.user_preferences add constraint user_preferences_custom_ai_provider_check
  check (custom_ai_provider = any (array[
    'lovable'::text,
    'github_models'::text,
    'google'::text,
    'openai'::text,
    'anthropic'::text,
    'openrouter'::text,
    'qwen'::text
  ]));


alter table public.ai_provider_credentials drop constraint if exists ai_provider_credentials_provider_check;

alter table public.ai_provider_credentials add constraint ai_provider_credentials_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'openrouter', 'qwen'));
