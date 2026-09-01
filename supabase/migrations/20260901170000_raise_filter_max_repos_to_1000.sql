-- Allow the explicit "All accessible repositories" portfolio scope.
-- GitHub pagination and the API intentionally cap a single run at 1,000 repos.
alter table public.user_preferences
  drop constraint if exists user_preferences_filter_max_repos_check;

alter table public.user_preferences
  add constraint user_preferences_filter_max_repos_check
  check (filter_max_repos between 2 and 1000);

alter table public.user_preferences
  alter column filter_max_repos set default 1000;
