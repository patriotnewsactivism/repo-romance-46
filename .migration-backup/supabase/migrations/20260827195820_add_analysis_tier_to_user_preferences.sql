alter table public.user_preferences
  add column if not exists analysis_tier text not null default 'balanced';

alter table public.user_preferences
  drop constraint if exists user_preferences_analysis_tier_check;

alter table public.user_preferences
  add constraint user_preferences_analysis_tier_check
  check (analysis_tier = any (array['fast'::text, 'balanced'::text, 'deep'::text]));
