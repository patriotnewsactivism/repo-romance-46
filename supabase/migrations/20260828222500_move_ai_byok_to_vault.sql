alter table public.user_preferences
  add column if not exists custom_ai_vault_secret_id uuid;

create or replace function public.repo_finisher_store_ai_secret(
  p_user_id uuid,
  p_secret text,
  p_existing_secret_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_name text;
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;
  if p_secret is null or length(trim(p_secret)) = 0 then
    raise exception 'secret is required';
  end if;
  if length(p_secret) > 4000 then
    raise exception 'secret is too long';
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text;

  if p_existing_secret_id is not null and exists (
    select 1
    from vault.secrets
    where id = p_existing_secret_id
      and name = v_name
  ) then
    perform vault.update_secret(
      p_existing_secret_id,
      p_secret,
      v_name,
      'RepoFinisher BYOK AI provider credential',
      null
    );
    return p_existing_secret_id;
  end if;

  v_id := vault.create_secret(
    p_secret,
    v_name,
    'RepoFinisher BYOK AI provider credential',
    null
  );
  return v_id;
end;
$$;

create or replace function public.repo_finisher_read_ai_secret(
  p_user_id uuid,
  p_secret_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = public, vault, pg_temp
as $$
declare
  v_name text;
  v_secret text;
begin
  if p_user_id is null or p_secret_id is null then
    return null;
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text;
  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where id = p_secret_id
     and name = v_name
   limit 1;

  return v_secret;
end;
$$;

create or replace function public.repo_finisher_delete_ai_secret(
  p_user_id uuid,
  p_secret_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_name text;
begin
  if p_user_id is null or p_secret_id is null then
    return;
  end if;

  v_name := 'repo-finisher-ai-' || p_user_id::text;
  delete from vault.secrets
   where id = p_secret_id
     and name = v_name;
end;
$$;

revoke all on function public.repo_finisher_store_ai_secret(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.repo_finisher_read_ai_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.repo_finisher_delete_ai_secret(uuid, uuid) from public, anon, authenticated;

grant execute on function public.repo_finisher_store_ai_secret(uuid, text, uuid) to service_role;
grant execute on function public.repo_finisher_read_ai_secret(uuid, uuid) to service_role;
grant execute on function public.repo_finisher_delete_ai_secret(uuid, uuid) to service_role;

-- Migrate historical plaintext BYOK values. Encrypted enc1 envelopes are left in
-- place because they require their original application encryption key to open.
do $$
declare
  r record;
  v_secret_id uuid;
begin
  for r in
    select user_id, custom_ai_key
      from public.user_preferences
     where custom_ai_key is not null
       and custom_ai_key not like 'enc1.%'
       and custom_ai_vault_secret_id is null
  loop
    v_secret_id := public.repo_finisher_store_ai_secret(r.user_id, r.custom_ai_key, null);
    update public.user_preferences
       set custom_ai_vault_secret_id = v_secret_id,
           custom_ai_key = null,
           updated_at = now()
     where user_id = r.user_id;
  end loop;
end;
$$;

comment on column public.user_preferences.custom_ai_vault_secret_id is
  'Opaque reference to a BYOK provider credential stored in Supabase Vault. The browser never receives the decrypted secret.';
