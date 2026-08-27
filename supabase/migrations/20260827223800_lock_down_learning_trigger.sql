-- Trigger-only helper: it must never be directly callable through PostgREST RPC.
REVOKE ALL ON FUNCTION public.capture_completion_run_learning() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_completion_run_learning() FROM anon;
REVOKE ALL ON FUNCTION public.capture_completion_run_learning() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.capture_completion_run_learning() TO service_role;

COMMENT ON FUNCTION public.capture_completion_run_learning() IS
  'Internal trigger-only function. Direct RPC execution is revoked from public, anon, and authenticated roles.';
