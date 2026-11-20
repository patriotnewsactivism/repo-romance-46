-- Ported from supabase/migrations/20260910211000_provider_scoped_ai_credentials.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

-- Persist one BYOK credential per AI provider instead of one shared credential.
-- Model selection remains ordinary application configuration; only provider API
-- keys are stored in Vault.

create table if not exists public.ai_provider_credentials (
  user_id uuid not null references app_users (id) on delete cascade,
  provider text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  constraint ai_provider_credentials_provider_check
    check (provider in ('google', 'openai', 'anthropic', 'openrouter'))
);


-- Preserve the currently stored legacy Vault reference by associating it with
-- the provider that owned it at migration time. The legacy preference columns
-- remain compatibility-only after this migration.
insert into public.ai_provider_credentials (user_id, provider, vault_secret_id)
select
  user_id,
  lower(custom_ai_provider),
  custom_ai_vault_secret_id
from public.user_preferences
where custom_ai_vault_secret_id is not null
  and lower(custom_ai_provider) in ('google', 'openai', 'anthropic', 'openrouter')
on conflict (user_id, provider) do nothing;
