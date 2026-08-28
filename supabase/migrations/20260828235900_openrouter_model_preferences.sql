alter table public.user_preferences
  add column if not exists custom_ai_model text;

comment on column public.user_preferences.custom_ai_model is
  'Allowlisted OpenRouter model identifier. Ignored for direct provider connections.';
