-- Keep one efficient ownership policy for AI provider preferences.
-- The previous policies were equivalent, but one targeted public and both
-- re-evaluated auth.uid() for every row.

drop policy if exists "own preferences" on public.user_preferences;
drop policy if exists "users manage own preferences" on public.user_preferences;

create policy "users manage own preferences"
  on public.user_preferences
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
