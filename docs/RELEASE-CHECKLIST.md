# Production Release Checklist

Use this checklist for any RepoFinisher change that can affect production behavior, data, security, autonomy, deployment, or user-visible functionality.

Not every item applies to every PR. Mark non-applicable items explicitly rather than silently skipping them.

## Before merge

- [ ] Problem/root cause is stated with evidence.
- [ ] Scope is focused; unrelated refactors are excluded.
- [ ] `AGENTS.md`, architecture, security, and current project state were reviewed where applicable.
- [ ] No secret values were committed, logged, documented, or moved into `VITE_*` variables.
- [ ] Database changes are represented by forward migration files.
- [ ] RLS/grants/service-role implications were reviewed.
- [ ] Repository-write/autonomy changes preserve approval, stale-base, branch/PR, and no-auto-merge boundaries.
- [ ] Self-healing changes do not weaken acceptance criteria.
- [ ] Cloud Run worker changes preserve durable session/lease semantics and do not duplicate writes on retry.
- [ ] Documentation is updated for changed architecture, variables, hosting, security storage, or operating behavior.
- [ ] `pnpm install --frozen-lockfile` succeeds or CI proves it.
- [ ] Tests pass.
- [ ] Typecheck/build pass.
- [ ] Documentation topology guard passes.
- [ ] GitHub CI is green.
- [ ] Known remaining gaps are stated in the PR instead of hidden.

## Database release

If the release contains a Supabase migration:

- [ ] SQL reviewed for destructive/irreversible operations.
- [ ] RLS/policies reviewed.
- [ ] `security definer`/search-path behavior reviewed where applicable.
- [ ] Grants/revokes reviewed for browser and trusted roles.
- [ ] Data transformations are deterministic and safe.
- [ ] Migration was applied to the intended project.
- [ ] Resulting schema/policies/functions were verified after apply.
- [ ] Application deployment ordering is understood.

## Google Cloud build and identity

For production-impacting runtime changes:

- [ ] Deployment authenticates through GitHub OIDC/Workload Identity Federation.
- [ ] No long-lived Google service-account JSON key was introduced.
- [ ] Immutable images are tagged from the intended Git commit SHA.
- [ ] Images are pushed to the intended Artifact Registry repository.
- [ ] Deploy/runtime service-account permissions remain least-privilege.
- [ ] Required Secret Manager bindings are present.
- [ ] Backend secret values were not copied into workflow output or build args.

## Cloud Run completion-session Job

If worker/iterative completion behavior changed:

- [ ] `repofinisher-completion-session` deploys successfully.
- [ ] Expected command/entrypoint is correct.
- [ ] CPU/memory/task-timeout/retry settings are intentional.
- [ ] API runtime can execute the specific Job with required overrides.
- [ ] Job overrides contain only minimal non-secret identifiers.
- [ ] Durable session state remains authoritative.
- [ ] Lease/heartbeat logic prevents duplicate active workers/branch writes.
- [ ] Bounded CI repair can finish or safely yield within worker execution.

## Cloud Run API

If backend/control-plane behavior changed:

- [ ] `repofinisher-api` deploys from the intended `main` commit.
- [ ] Build/image creation succeeds.
- [ ] Service reaches healthy state.
- [ ] `/api/healthz` passes on the direct Cloud Run URL.
- [ ] Required public/runtime environment variables are present.
- [ ] Required Secret Manager references are present.
- [ ] CORS matches the actual canonical frontend origin.
- [ ] Relevant authenticated API route works.
- [ ] Logs show no new recurring release-caused error.

## Cloud Run frontend

If frontend behavior changed:

- [ ] `repofinisher-web` image is built from the intended commit.
- [ ] `VITE_API_BASE_URL` points to the intended Cloud Run API.
- [ ] Supabase browser variables are present.
- [ ] Direct Cloud Run frontend verification passes.
- [ ] SPA routes work.
- [ ] Auth/session restoration works when applicable.
- [ ] Settings/API calls reach `repofinisher-api`, not the static web host.
- [ ] Mobile header/menu/theme contrast is checked.
- [ ] No private credential was added to frontend configuration.

## Custom domain and Cloudflare

If domain/DNS configuration is affected:

- [ ] Direct frontend/API surfaces are healthy before DNS mutation.
- [ ] Cloud Run domain mapping targets `repofinisher-web`.
- [ ] Mapping emits valid DNS records.
- [ ] Cloudflare zone/record change targets `repofinisher.donmatthews.live`.
- [ ] Cloudflare token remains in secret storage.
- [ ] Canonical HTTPS domain resolves and serves the intended frontend revision.
- [ ] Certificate/domain propagation state is verified rather than assumed.

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
- [ ] Finish Portfolio does not use a weaker self-healing/safety path than direct finishing.

## Production verification

For material releases:

- [ ] Cloud Run API direct URL is reachable.
- [ ] Cloud Run frontend direct URL is reachable.
- [ ] Supabase seam is reachable.
- [ ] Canonical custom domain is reachable when DNS is part of the release.
- [ ] `.github/workflows/production-smoke.yml` passes or equivalent evidence is recorded.
- [ ] Relevant authenticated user journey was tested.
- [ ] A real Cloud Run completion-session Job was exercised when worker changes require it.
- [ ] Rollback path is understood before DNS/data/security changes.

## Rollback readiness

- [ ] Known-good prior Cloud Run revision/image is identified when appropriate.
- [ ] Database compatibility with rollback is understood.
- [ ] DNS rollback is not attempted until a known-good target is ready.
- [ ] Legacy Render/Netlify rollback is used only if explicitly verified and still secure.
- [ ] Vercel is not used as an emergency fallback.

## After release

- [ ] `docs/PROJECT_STATE.md` updated if operational state changed.
- [ ] `docs/DECISIONS.md` updated if a durable architecture/product decision changed.
- [ ] Temporary migration/cutover warnings removed once actually resolved.
- [ ] New production blockers are recorded instead of left only in chat/logs.
- [ ] Outcome/learning telemetry is checked for autonomous completion changes.
- [ ] Obsolete rollback infrastructure is retired after its rollback purpose expires.

## Release-state language

Report what was actually verified. Use these states precisely:

- source fixed;
- PR merged;
- migration applied;
- image built;
- service/job deployed;
- direct runtime verified;
- canonical domain verified;
- authenticated user flow verified.

They are not interchangeable.