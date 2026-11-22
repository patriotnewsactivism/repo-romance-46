-- Ported from supabase/migrations/20260827223800_lock_down_learning_trigger.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

COMMENT ON FUNCTION public.capture_completion_run_learning() IS
  'Internal trigger-only function. Direct RPC execution is revoked from public, anon, and authenticated roles.';
