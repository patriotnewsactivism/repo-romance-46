-- Keep adaptive-memory access user-scoped without evaluating auth.uid() once per row.
DROP POLICY IF EXISTS "Users manage their own repo learnings" ON public.repo_learnings;
CREATE POLICY "Users manage their own repo learnings"
  ON public.repo_learnings FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own cross-repo patterns" ON public.cross_repo_patterns;
CREATE POLICY "Users manage their own cross-repo patterns"
  ON public.cross_repo_patterns FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The UNIQUE(user_id, repo/pattern) indexes already cover user-prefixed lookups.
DROP INDEX IF EXISTS public.repo_learnings_user_repo_idx;
DROP INDEX IF EXISTS public.cross_repo_patterns_user_idx;
