-- Core tables that were created directly in the Supabase project and therefore
-- never existed as migrations in this repository. Rebuilt here so a fresh
-- Postgres can serve the application. Column types are deliberately permissive
-- (text/jsonb) because the code reads these as plain objects.

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users (id) on delete cascade,
  status text,
  mode text,
  stage text,
  repo text,
  repos text[],
  repo_count integer,
  analyzed_repo_names text[],
  filter_max_repos integer,
  filter_languages text[],
  filter_min_stars integer,
  filter_exclude_archived boolean,
  analysis_tier text,
  ai_provider text,
  ai_model text,
  prompt_version text,
  target_depth text,
  trigger_type text,
  progress_message text,
  error text,
  portfolio_run_id uuid,
  portfolio_stats jsonb,
  investment_intelligence jsonb,
  investment_intelligence_updated_at timestamptz,
  tiered_intelligence jsonb,
  tiered_intelligence_updated_at timestamptz,
  action_plan jsonb,
  action_plan_status text,
  action_plan_error text,
  action_plan_updated_at timestamptz,
  summary_md text,
  critique_md text,
  strategy_summary text,
  developer_profile jsonb,
  valuation jsonb,
  outcome_metrics jsonb,
  outcome_score numeric,
  completed_count integer default 0,
  failed_count integer default 0,
  is_public boolean not null default false,
  share_slug text unique,
  share_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analyses_user_created_idx on public.analyses (user_id, created_at desc);
create index if not exists analyses_share_slug_idx on public.analyses (share_slug);

create table if not exists public.analysis_items (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  user_id uuid references app_users (id) on delete cascade,
  rank integer not null default 0,
  kind text,
  title text,
  pitch text,
  repos text[],
  next_steps jsonb,
  effort integer,
  market_potential integer,
  estimated_hours numeric,
  tech_stack text[],
  marketing_tweet text,
  marketing_linkedin text,
  finish_result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analysis_items_analysis_idx on public.analysis_items (analysis_id, rank);

create table if not exists public.user_preferences (
  user_id uuid primary key references app_users (id) on delete cascade,
  email_notifications boolean not null default true,
  schedule_enabled boolean not null default false,
  schedule_frequency text,
  custom_ai_provider text,
  custom_ai_model text,
  custom_ai_reasoning_effort text,
  custom_ai_key text,
  custom_ai_vault_secret_id uuid,
  filter_max_repos integer,
  filter_languages text[],
  filter_min_stars integer,
  filter_exclude_archived boolean,
  analysis_tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.github_connections (
  user_id uuid primary key references app_users (id) on delete cascade,
  github_id text,
  github_user_id text,
  connected_at timestamptz,
  github_login text,
  avatar_url text,
  display_name text,
  access_token text,
  scope text,
  scopes text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  repo_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.github_credentials (
  user_id uuid primary key references app_users (id) on delete cascade,
  access_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operational_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users (id) on delete set null,
  repo_full_name text,
  content jsonb,
  anonymized boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
