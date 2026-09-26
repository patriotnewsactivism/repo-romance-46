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
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter', 'qwen') then
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
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter', 'qwen') then
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
  if v_provider not in ('google', 'openai', 'anthropic', 'openrouter', 'qwen') then
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
