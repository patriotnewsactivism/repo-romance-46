-- Allow authenticated RepoFinisher users to manage only their own BYOK Vault
-- credential. This removes the runtime dependency on a privileged Supabase API
-- key for ordinary user credential saves while preserving service_role access
-- for administrative/migration workflows.

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
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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

grant execute on function public.repo_finisher_store_ai_secret(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.repo_finisher_read_ai_secret(uuid, uuid) to authenticated, service_role;
grant execute on function public.repo_finisher_delete_ai_secret(uuid, uuid) to authenticated, service_role;
