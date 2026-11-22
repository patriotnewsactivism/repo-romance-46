-- Ported from supabase/migrations/20260827224000_optimize_learning_rls.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

-- The UNIQUE(user_id, repo/pattern) indexes already cover user-prefixed lookups.
DROP INDEX IF EXISTS public.repo_learnings_user_repo_idx;

DROP INDEX IF EXISTS public.cross_repo_patterns_user_idx;
