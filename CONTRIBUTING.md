# Contributing to RepoFinisher

RepoFinisher is a production-oriented autonomous repository-completion system. Changes should improve verified completion quality without weakening security, approval, rollback, or operational reliability.

Before contributing, read:

- `README.md`
- `AGENTS.md`
- `SECURITY.md`
- `docs/PROJECT_STATE.md`

For architecture/deployment work also read `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/CLOUD_RUN_MIGRATION.md`.

## Branches and pull requests

Use a focused branch for each coherent change.

Examples:

```text
fix/settings-ai-provider-save
feat/iterative-completion-controller
docs/reconcile-cloud-run-production
```

Open a pull request against `main` and describe:

- verified problem/root cause;
- implementation;
- migration/deployment impact;
- tests/evidence;
- security/autonomy impact;
- risks and remaining gaps.

Do not hide known incomplete work in optimistic PR language.

`main` is branch-protected and required CI must remain green.

## Required checks

Use pnpm only.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

GitHub CI is authoritative for merge readiness. Do not bypass a red pipeline.

## Production hosting

Current production target topology is:

- Google Cloud Run `repofinisher-web` — frontend;
- Google Cloud Run `repofinisher-api` — API/control plane;
- Google Cloud Run Job `repofinisher-completion-session` — long-running work;
- Supabase — auth/database/RLS/Vault/durable state;
- GitHub/GitHub Actions — source, CI, PRs, deployment automation;
- Artifact Registry + Secret Manager — images and backend secrets;
- Cloudflare — canonical custom-domain DNS;
- Sentry/Cloud Logging — observability.

Vercel must never be used or reintroduced as a deployment target.

Former Netlify/Render configuration is legacy migration/rollback material, not the canonical production target. Do not reactivate it silently.

## Google Cloud changes

Deployment uses GitHub OIDC + Google Workload Identity Federation. Do not add a long-lived Google service-account JSON key.

When changing Cloud Run infrastructure, review:

- API/frontend/worker service names and regions;
- runtime/deploy service-account permissions;
- Cloud Run Job retry/timeout behavior;
- Secret Manager bindings;
- Artifact Registry image provenance;
- custom-domain mapping and Cloudflare DNS behavior;
- direct-host health checks before domain cutover;
- rollback to a known-good revision/target.

Long-running workers must resume durable Supabase state rather than replay completed writes after retries.

## Database changes

Put all schema changes in `supabase/migrations/`.

A migration PR should explain:

- tables/columns/functions changed;
- RLS/policy impact;
- grants/revokes;
- data transformation behavior;
- destructive/irreversible operations;
- application deployment ordering.

Use least privilege. Service-role-only Vault operations must remain unavailable to normal browser roles.

## Secrets

Never commit secrets or embed private values in frontend variables.

Do not include secrets in PR descriptions, issues, test fixtures, screenshots, docs, or logs.

If a secret is exposed, rotate/revoke it immediately; deleting it from the latest commit is not sufficient if it entered Git history.

## AI/provider changes

Supported provider/model behavior must remain explicit and testable.

When adding/changing a provider:

1. implement provider normalization/status;
2. implement exact model handling;
3. use Supabase Vault for user BYOK;
4. ensure keys are never returned to the frontend;
5. implement provider-specific invocation mapping;
6. add tests;
7. update Settings UX/docs;
8. verify persistence and an actual invocation path.

Do not add a provider name to the UI before the backend can actually use it.

## Reasoning and learning changes

Preserve the distinction between:

- immutable safety/approval/permission policy;
- mutable planning/reasoning strategy.

Prefer measured outcomes over subjective prompt tweaks. Add tests for minimum evidence, regression, failure memory, and bounded stop conditions.

Never describe operational learning as silent model-weight retraining.

## Autonomous-write changes

Any increase in write authority or autonomy requires explicit review of:

- approval behavior;
- stale-base behavior;
- branch/PR rollback boundaries;
- path/content safety;
- secret handling;
- repair limits;
- merge policy;
- cost/time/risk budgets;
- duplicate-worker/lease behavior.

Do not silently convert a recommendation feature into repository writes.

## UI changes

Verify mobile and desktop behavior.

For header/theme work verify contrast, hamburger behavior, opaque menus, broken-image handling, and both theme states.

For Settings verify save/reload/error states, provider/model persistence, BYOK behavior, bearer-token handling, and that API calls go to `repofinisher-api` rather than the static frontend service.

## Documentation changes

Architecture, environment variables, hosting, security storage, migration requirements, autonomy policy, or operational behavior changes must update canonical documentation in the same PR.

Model-specific files should remain thin pointers to `AGENTS.md`; do not fork repository policy into competing instruction documents.

## Definition of done for a repository change

A code change is not done merely because it was written or merged.

Depending on scope, completion may require:

- tests green;
- build/typecheck green;
- migration applied and verified;
- Cloud Run Job/API/frontend deployment healthy;
- direct-host and canonical-domain checks green;
- production smoke green;
- relevant authenticated user flow verified;
- no new recurring runtime errors;
- outcome telemetry observed for autonomous changes;
- documentation/project state updated.

Record exactly what was verified. `merged`, `deployed`, `runtime verified`, and `user-flow verified` are different states.