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
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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

  -- A previous request may have created the Vault secret and then failed before
  -- user_preferences.custom_ai_vault_secret_id was persisted. Reclaim that
  -- deterministic per-user secret instead of attempting a duplicate insert.
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
      'RepoFinisher BYOK AI provider credential',
      null
    );
    return v_id;
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
