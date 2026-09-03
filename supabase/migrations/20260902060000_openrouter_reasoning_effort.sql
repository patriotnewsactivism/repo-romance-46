alter table public.user_preferences
  add column if not exists custom_ai_reasoning_effort text;

alter table public.user_preferences
  drop constraint if exists user_preferences_custom_ai_reasoning_effort_check;

alter table public.user_preferences
  add constraint user_preferences_custom_ai_reasoning_effort_check
  check (
    custom_ai_reasoning_effort is null
    or custom_ai_reasoning_effort in ('max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none')
  );

comment on column public.user_preferences.custom_ai_reasoning_effort is
  'Optional OpenRouter reasoning effort persisted with the exact selected model slug.';
