-- Ported from supabase/migrations/20260828222500_move_ai_byok_to_vault.sql
-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.

alter table public.user_preferences
  add column if not exists custom_ai_vault_secret_id uuid;


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
