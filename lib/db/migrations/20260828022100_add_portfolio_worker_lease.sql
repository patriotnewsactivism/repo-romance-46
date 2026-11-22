-- Ported from supabase/migrations/20260828022100_add_portfolio_worker_lease.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

alter table public.portfolio_completion_runs
  add column if not exists worker_token text;


alter table public.portfolio_completion_runs
  add column if not exists lease_expires_at timestamptz;


alter table public.portfolio_completion_runs
  add column if not exists heartbeat_at timestamptz;
