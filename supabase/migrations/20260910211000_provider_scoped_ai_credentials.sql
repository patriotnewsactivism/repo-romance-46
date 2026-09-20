-- Persist one BYOK credential per AI provider instead of one shared credential.
-- Model selection remains ordinary application configuration; only provider API
-- keys are stored in Vault.

create table if not exists public.ai_provider_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  constraint ai_provider_credentials_provider_check
    check (provider in ('google', 'openai', 'anthropic', 'openrouter'))
);

alter table public.ai_provider_credentials enable row level security;

drop policy if exists "Users can read own AI provider credentials" on public.ai_provider_credentials;
create policy "Users can read own AI provider credentials"
  on public.ai_provider_credentials
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own AI provider credentials" on public.ai_provider_credentials;
create policy "Users can insert own AI provider credentials"
  on public.ai_provider_credentials
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own AI provider credentials" on public.ai_provider_credentials;
create policy "Users can update own AI provider credentials"
  on public.ai_provider_credentials
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own AI provider credentials" on public.ai_provider_credentials;
create policy "Users can delete own AI provider credentials"
  on public.ai_provider_credentials
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_provider_credentials to authenticated;

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

-- Provider-scoped Vault RPCs. New secrets use deterministic names that include
-- both user and provider. Existing legacy per-user secrets are accepted and
-- renamed on the next write so current users are migrated without losing keys.
create or replace function public.repo_finisher_store_ai_provider_secret(
  p_user_id uuid,
  p_provider text,
  p_secret text,
  p_existing_secret_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_provider text;
  v_name text;
  v_legacy_name text;
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  v_provider := lower(trim(coalesce(p_provider, '')));
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter') then
    raise exception 'unsupported provider';
  end if;
  if p_secret is null or length(trim(p_secret)) = 0 then
    raise exception 'secret is required';
  end if;
  if length(p_secret) > 4000 then
    raise exception 'secret is too long';
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text || '-' || v_provider;
  v_legacy_name := 'repo-finisher-ai-' || p_user_id::text;

  if p_existing_secret_id is not null and exists (
    select 1
      from vault.secrets
     where id = p_existing_secret_id
       and name in (v_name, v_legacy_name)
  ) then
    perform vault.update_secret(
      p_existing_secret_id,
      p_secret,
      v_name,
      'RepoFinisher BYOK ' || v_provider || ' provider credential',
      null
    );
    return p_existing_secret_id;
  end if;

  -- Reclaim an orphaned provider-scoped secret created by a prior interrupted
  -- request rather than creating duplicate Vault entries.
  select id
    into v_id
    from vault.secrets
   where name = v_name
   limit 1;

  if v_id is not null then
    perform vault.update_secret(
      v_id,
      p_secret,
      v_name,
      'RepoFinisher BYOK ' || v_provider || ' provider credential',
      null
    );
    return v_id;
  end if;

  v_id := vault.create_secret(
    p_secret,
    v_name,
    'RepoFinisher BYOK ' || v_provider || ' provider credential',
    null
  );
  return v_id;
end;
$$;

create or replace function public.repo_finisher_read_ai_provider_secret(
  p_user_id uuid,
  p_provider text,
  p_secret_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = public, vault, pg_temp
as $$
declare
  v_provider text;
  v_name text;
  v_legacy_name text;
  v_secret text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null or p_secret_id is null then
    return null;
  end if;

  v_provider := lower(trim(coalesce(p_provider, '')));
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter') then
    raise exception 'unsupported provider';
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text || '-' || v_provider;
  v_legacy_name := 'repo-finisher-ai-' || p_user_id::text;

  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where id = p_secret_id
     and name in (v_name, v_legacy_name)
   limit 1;

  return v_secret;
end;
$$;

create or replace function public.repo_finisher_delete_ai_provider_secret(
  p_user_id uuid,
  p_provider text,
  p_secret_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_provider text;
  v_name text;
  v_legacy_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null or p_secret_id is null then
    return;
  end if;

  v_provider := lower(trim(coalesce(p_provider, '')));
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter') then
    raise exception 'unsupported provider';
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text || '-' || v_provider;
  v_legacy_name := 'repo-finisher-ai-' || p_user_id::text;

  delete from vault.secrets
   where id = p_secret_id
     and name in (v_name, v_legacy_name);
end;
$$;

revoke all on function public.repo_finisher_store_ai_provider_secret(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.repo_finisher_read_ai_provider_secret(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.repo_finisher_delete_ai_provider_secret(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.repo_finisher_store_ai_provider_secret(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.repo_finisher_read_ai_provider_secret(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.repo_finisher_delete_ai_provider_secret(uuid, text, uuid) to authenticated, service_role;
