# Production Release Checklist

Use this checklist for any RepoFinisher change that can affect production behavior, data, security, autonomy, deployment, or user-visible functionality.

Not every line applies to every PR. Mark non-applicable items explicitly rather than silently skipping them.

## Before merge

- [ ] Problem/root cause is stated with evidence.
- [ ] Scope is focused; unrelated refactors are excluded.
- [ ] `AGENTS.md`/architecture/security constraints were reviewed when applicable.
- [ ] No secret values were committed, logged, documented, or moved into `VITE_*` variables.
- [ ] Database changes are represented by forward migration files.
- [ ] RLS/grants/service-role implications were reviewed.
- [ ] Repository-write/autonomy changes preserve approval, stale-base, branch/PR, and no-auto-merge boundaries.
- [ ] Self-healing changes do not weaken acceptance criteria.
- [ ] Documentation is updated for changed architecture, variables, hosting, security storage, or operating behavior.
- [ ] `pnpm install --frozen-lockfile` succeeds or CI proves it.
- [ ] Tests pass.
- [ ] Typecheck/build pass.
- [ ] GitHub CI is green.
- [ ] Known remaining gaps are stated in the PR instead of hidden.

## Database release

If the release contains a Supabase migration:

- [ ] SQL reviewed for destructive/irreversible operations.
- [ ] RLS/policies reviewed.
- [ ] Function `security definer`/search-path behavior reviewed where applicable.
- [ ] Grants/revokes reviewed for `anon`, `authenticated`, and `service_role`.
- [ ] Data transformations are deterministic and safe.
- [ ] Migration was applied to the intended project.
- [ ] Resulting schema/policies/functions were verified after apply.
- [ ] App deployment ordering is understood.

## Backend release — Render

If API/backend behavior changed:

- [ ] Canonical service is `repofinisher-api-live`.
- [ ] Service deploys from `main`.
- [ ] Build succeeds.
- [ ] Service reaches healthy/live state.
- [ ] Required backend variables are present.
- [ ] No private credential was added to frontend configuration.
- [ ] Relevant API route/health behavior is verified.
- [ ] Logs show no new recurring error caused by the release.

## Frontend release — Netlify

If frontend behavior changed:

- [ ] Netlify deploy uses current `main`.
- [ ] Build succeeds.
- [ ] `VITE_API_BASE_URL` points to the Render API.
- [ ] Supabase browser variables are present.
- [ ] SPA routes work.
- [ ] Auth/session restoration works when applicable.
- [ ] Settings/API calls use Render, not the static frontend host.
- [ ] Mobile header/menu/theme contrast is checked.
- [ ] Canonical custom domain is verified over HTTPS.

## AI provider/BYOK release

If provider/model/settings behavior changed:

- [ ] Provider is implemented in backend request mapping before being exposed in UI.
- [ ] Exact model identifier persists and reloads.
- [ ] New BYOK credentials are stored in Supabase Vault.
- [ ] Browser/API responses never return decrypted keys.
- [ ] Provider switch does not silently reuse another provider's credential.
- [ ] Save/reload/test/remove behavior is verified.
- [ ] Persistence failures and provider invocation failures are distinguishable.

## Reasoning/autonomy release

If planning, learning, repair, or orchestration changed:

- [ ] Current repository evidence is still collected before planning.
- [ ] Immutable safety/approval policy remains outside prompt experimentation.
- [ ] Reasoning traces/outcome telemetry remain auditable.
- [ ] Failure memory prevents repeating identical failed strategy without new evidence.
- [ ] Repair limits and stop conditions remain bounded.
- [ ] Passing CI alone is not treated as proof of full repository completion.
- [ ] Post-run completion/readiness is re-measured when applicable.

## Production verification

For material production changes:

- [ ] Netlify frontend is reachable if applicable.
- [ ] Render API is reachable.
- [ ] Supabase seam is reachable.
- [ ] `.github/workflows/production-smoke.yml` passes, or equivalent evidence is recorded.
- [ ] Relevant authenticated user journey was tested.
- [ ] Rollback path is understood before DNS/data/security changes.

## After release

- [ ] `docs/PROJECT_STATE.md` updated if the operational checkpoint changed.
- [ ] `docs/DECISIONS.md` updated if a durable architecture/product decision changed.
- [ ] Any temporary migration/cutover warning removed once actually resolved.
- [ ] New production blocker is recorded instead of being left only in chat/logs.
- [ ] Outcome/learning telemetry is checked for autonomous completion changes.

## Release note rule

Report what was actually verified. Use terms such as `merged`, `deployed`, `runtime verified`, and `user-flow verified` precisely; they are not interchangeable.