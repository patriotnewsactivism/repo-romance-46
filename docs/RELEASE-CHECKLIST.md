# RepoFinisher Release Checklist

Use this checklist for production-impacting changes. Not every item applies to every PR, but skipped items should be consciously inapplicable rather than forgotten.

## 1. Scope and source

- [ ] Change is on a focused branch.
- [ ] PR explains the user-visible/operational intent.
- [ ] Diff does not bundle unrelated refactors into a production fix.
- [ ] Current `main` was used as the base or drift was deliberately reconciled.
- [ ] Architecture/security/hosting changes update the corresponding docs in the same PR.

## 2. Repository policy

- [ ] `AGENTS.md` has been read for autonomous/coding-agent work.
- [ ] No Vercel deployment artifact or production dependency was reintroduced.
- [ ] No private secret appears in source, docs, fixtures, screenshots, or logs.
- [ ] No private credential is placed in a `VITE_*` variable.
- [ ] pnpm remains the package manager and the lockfile is consistent.

## 3. Automated verification

Run or obtain equivalent green CI evidence for:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

- [ ] Tests pass.
- [ ] Typecheck/build pass.
- [ ] CI non-Vercel hosting guard passes.
- [ ] New/changed behavior has targeted tests where practical.
- [ ] Existing tests/acceptance criteria were not weakened just to obtain green CI.

## 4. Database / Supabase

If the change requires a migration:

- [ ] Migration exists under `supabase/migrations/`.
- [ ] Migration is forward-only and deterministic.
- [ ] Existing production data is preserved or an explicit reviewed transformation exists.
- [ ] RLS impact was reviewed.
- [ ] Grants/revokes were reviewed for least privilege.
- [ ] `security definer` functions use an intentional search path and narrow execution grants.
- [ ] Service-role-only functions remain unavailable to `anon`/`authenticated` unless explicitly justified.
- [ ] Migration was applied to the intended project.
- [ ] Resulting schema/permissions were verified after application.

For Vault/BYOK changes:

- [ ] Browser/authenticated clients cannot read decrypted credentials.
- [ ] Secret values are not returned in API responses/logs.
- [ ] Replacement/removal cleans up obsolete Vault secrets safely.

## 5. Backend / Render

If the API changed:

- [ ] Canonical service is `repofinisher-api-live` or the documented successor.
- [ ] Deployment is built from the intended `main` commit.
- [ ] Render deployment reaches healthy/live state.
- [ ] Health endpoint responds successfully.
- [ ] Logs were inspected for new errors/warnings.
- [ ] Long-running reasoning/background behavior still works within the service model.
- [ ] No frontend-only environment variable is being used as a backend secret.

## 6. Frontend / Netlify

If the frontend changed:

- [ ] Netlify built the intended `main` commit.
- [ ] `VITE_API_BASE_URL` points at the canonical Render API.
- [ ] Supabase public browser values are present.
- [ ] No private backend variable was copied into Netlify `VITE_*` configuration.
- [ ] SPA routing works on refresh/deep links.
- [ ] Header/navigation remain readable on mobile and desktop.
- [ ] Dark/light theme behavior is readable and intentional.
- [ ] Authenticated API calls carry the Supabase bearer token across the Netlify -> Render boundary.

## 7. Production domain

Before DNS/domain cutover:

- [ ] Replacement frontend deployment is already healthy.
- [ ] HTTPS works on the target.
- [ ] Canonical hostname is verified exactly.
- [ ] API CORS explicitly allows the canonical frontend origin.
- [ ] Rollback destination is known.

Do not switch DNS first and hope the replacement deployment works afterward.

## 8. AI provider / model Settings

When provider/model/BYOK behavior changed, test the applicable providers:

- [ ] Google
- [ ] OpenAI
- [ ] Anthropic
- [ ] OpenRouter

For each tested provider:

- [ ] save provider + exact model identifier,
- [ ] save credential,
- [ ] reload Settings without receiving the secret value,
- [ ] test provider/model connection if supported,
- [ ] switch provider without silently reusing the prior provider's secret,
- [ ] remove credential,
- [ ] confirm credential/Vault cleanup behaves correctly,
- [ ] confirm errors are specific enough to diagnose provider/model/key failures.

## 9. Autonomous completion behavior

When reasoning/finishing/repair changed:

- [ ] Evidence collection uses the actual repository/current SHA.
- [ ] Plan is bound to the intended base commit.
- [ ] Exact-plan approval or defined bounded-autonomy acknowledgement still exists.
- [ ] Generated work goes to an isolated branch/draft PR.
- [ ] Automatic merge remains disabled unless policy was explicitly changed and reviewed.
- [ ] CI/deployment verification occurs before success is recorded.
- [ ] Self-healing does not weaken tests/security/CI criteria.
- [ ] Failed repair strategies are not repeated unchanged.
- [ ] Post-run completion/readiness outcome is measured and persisted.
- [ ] Learning receives the measured outcome.
- [ ] A first green PR is not automatically equated with a fully finished product when material blockers remain.

## 10. External completion handoffs

If the external-agent prompt generator changed:

- [ ] Prompt identifies repository and assessed SHA.
- [ ] Current-state evidence is included.
- [ ] Work is ordered and evidence-backed.
- [ ] Security/validation/stop conditions are included.
- [ ] Prompt instructs re-assessment when repository HEAD moved.
- [ ] Provider-specific formatting does not change substantive policy.
- [ ] No credential is included in generated handoff content.

See `docs/EXTERNAL_LLM_HANDOFFS.md`.

## 11. Production smoke

After production-impacting deployment, dispatch `.github/workflows/production-smoke.yml` using the actual production endpoints.

Expected seams:

- Netlify frontend
- Render API
- Supabase

- [ ] Smoke workflow passes.
- [ ] Authenticated high-risk user flow was manually or automatically exercised when smoke cannot cover it.

For Settings/BYOK work, production smoke alone is insufficient: perform an authenticated save/reload/test/remove acceptance flow.

## 12. Observability

- [ ] New failures are observable through structured logs and/or Sentry when configured.
- [ ] Logs do not contain secrets.
- [ ] Error metadata is actionable without exposing sensitive values.
- [ ] Source maps/releases are configured only with secret build tokens kept server/build-side.

## 13. Rollback

Before declaring release complete:

- [ ] Previous known-good code/deployment is identifiable.
- [ ] Database change rollback/forward-fix strategy is understood.
- [ ] Secret/key rotations do not strand unreadable credentials without a reconnection/migration plan.
- [ ] DNS/domain rollback is understood when applicable.

## 14. Documentation and state register

- [ ] `README.md` still describes the product accurately.
- [ ] `AGENTS.md` reflects any new operating rule.
- [ ] `SECURITY.md` reflects any changed security boundary.
- [ ] `docs/ARCHITECTURE.md` reflects architecture changes.
- [ ] `docs/OPERATIONS.md` reflects deployment/incident changes.
- [ ] `docs/PROJECT_STATE.md` was updated for completed priorities/new blockers.
- [ ] `docs/DECISIONS.md` contains durable architecture/product decisions worth preserving.

## Release completion rule

A release is not complete merely because a commit was merged.

For a production capability, use the strongest applicable evidence chain:

```text
merged code
+ green CI
+ required migration applied
+ target deployment healthy
+ runtime/user flow verified
+ telemetry/learning recorded where applicable
```

If one of those layers is missing, describe the capability as implemented-but-unverified rather than production-complete.
