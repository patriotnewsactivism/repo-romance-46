-- Supabase Vault is gone: provider keys are sealed with AES-256-GCM in app
-- code (SECRET_ENCRYPTION_KEY) and stored beside the credential row.
alter table public.ai_provider_credentials
  add column if not exists encrypted_secret text;
