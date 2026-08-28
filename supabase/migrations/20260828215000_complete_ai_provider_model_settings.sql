alter table public.user_preferences add column if not exists custom_ai_model text;

alter table public.user_preferences drop constraint if exists user_preferences_custom_ai_provider_check;
alter table public.user_preferences add constraint user_preferences_custom_ai_provider_check
  check (custom_ai_provider = any (array[
    'lovable'::text,
    'github_models'::text,
    'google'::text,
    'openai'::text,
    'anthropic'::text,
    'openrouter'::text
  ]));

comment on column public.user_preferences.custom_ai_model is
  'Optional exact model identifier for the selected AI provider. OpenRouter values use the provider model slug, for example provider/model-name.';
