-- Ported from supabase/migrations/20260828051500_prompt_strategy_experiments.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

create table if not exists public.prompt_strategy_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users (id) on delete cascade,
  incumbent_version text not null,
  incumbent_guidance text not null,
  challenger_version text,
  challenger_guidance text,
  challenger_traffic_pct integer not null default 25 check (challenger_traffic_pct between 0 and 50),
  min_scored_runs integer not null default 10 check (min_scored_runs between 5 and 100),
  practical_lift numeric not null default 4 check (practical_lift between 0 and 25),
  confidence_z numeric not null default 1.645 check (confidence_z between 1 and 4),
  status text not null default 'active' check (status in ('active', 'paused', 'needs_challenger')),
  promotion_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);


create index if not exists prompt_strategy_experiments_user_id_idx
on public.prompt_strategy_experiments (user_id);
