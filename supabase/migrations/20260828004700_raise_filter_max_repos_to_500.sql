-- Keep the database constraint aligned with the API/UI limit.
-- The previous CHECK constraint capped filter_max_repos at 100 even though
-- the application accepts values up to 500, causing saves above 100 to fail.

alter table public.user_preferences
  drop constraint if exists user_preferences_filter_max_repos_check;

alter table public.user_preferences
  add constraint user_preferences_filter_max_repos_check
  check (filter_max_repos >= 2 and filter_max_repos <= 500);
