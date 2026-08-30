# RepoFinisher Operations Guide

This is the production-operations runbook for RepoFinisher.

For time-sensitive status, read `docs/PROJECT_STATE.md` first. For the current Render-to-Google migration sequence, read `docs/CLOUD_RUN_MIGRATION.md`.

## Approved production stack

- Frontend: Netlify
- API/control plane: Google Cloud Run service
- Long-running finish-until-target work: Google Cloud Run Jobs
- Auth/database/RLS/Vault: Supabase
- Source/CI/PRs/check evidence: GitHub + GitHub Actions
- Observability: Sentry when configured plus Cloud Run/Cloud Logging

**Do not deploy RepoFinisher to Vercel.**

Render is a temporary rollback target during the Cloud Run cutover, not the target architecture.

## Production endpoints

Intended canonical frontend:

```text
https://repofinisher.donmatthews.live
```

Cloud Run API URL:

```text
assigned by the Deploy Cloud Run workflow after first successful deployment
```

Temporary rollback API during migration:

```text
https://repofinisher-api-live.onrender.com
```

Supabase project URL:

```text
https://rdsrxfzahhxbvugyarld.supabase.co
```

Never point Netlify at a replacement API merely because infrastructure creation succeeded. Verify the direct API URL first.

## Netlify frontend

`netlify.toml` is the repository-level frontend build definition.

Current build contract builds the shared TypeScript project references and then the production SPA under `artifacts/repo-finisher/dist/public`.

Required production browser variables:

```text
VITE_API_BASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Recommended observability variables:

```text
VITE_SENTRY_DSN
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE
```

Build-only Sentry upload values may include:

```text
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_RELEASE
```

Never prefix a private Sentry auth token with `VITE_`.

### Netlify deployment acceptance

Before treating a frontend deployment as production-ready:

1. Build succeeds from current `main`.
2. SPA routes resolve correctly.
3. Login/session restoration works.
4. Settings can call the selected persistent API across origins.
5. AI provider status/save/remove works.
6. Dashboard and repository views load.
7. Mobile header/menu contrast is readable.
8. No frontend API request falls back to the Netlify host when it should call the backend.
9. Production smoke passes.

## Google Cloud Run API

The target service name is:

```text
repofinisher-api
```

The API package is `@workspace/api-server`. The shared API/worker container is built from `Dockerfile.apiserver` and listens on Cloud Run's injected `PORT` (8080 is the container default).

Important server-side variables include:

```text
NODE_ENV=production
PORT
SUPABASE_URL
SUPABASE_ANON_KEY
CORS_ALLOWED_ORIGINS
LOG_LEVEL
CLOUD_RUN_JOBS_ENABLED=true
GCP_PROJECT_ID
GCP_REGION
COMPLETION_SESSION_JOB=repofinisher-completion-session
```

Sensitive server values are injected from Google Secret Manager:

```text
SUPABASE_SECRET_KEY
SECRET_ENCRYPTION_KEY
PLAN_SIGNING_SECRET
```

Optional platform AI fallback credentials/models may include:

```text
AI_PROVIDER
AI_MODEL
GEMINI_API_KEY
GOOGLE_API_KEY
GEMINI_MODEL
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
OPENROUTER_API_KEY
OPENROUTER_MODEL
```

User BYOK values remain in Supabase Vault and should not be copied into frontend variables.

### API sizing

Initial deployment settings are intentionally modest:

```text
1 CPU
1 GiB RAM
concurrency 20
min instances 0
max instances 5
```

The API is the control plane. Do not solve heavy-worker resource pressure by making the request-serving service permanently large unless measurements show the API itself needs it.

## Cloud Run completion-session worker

The target Job name is:

```text
repofinisher-completion-session
```

The worker uses the same immutable container image as the API but runs:

```text
node --enable-source-maps ./dist/completion-session-job.mjs
```

Initial allocation:

```text
2 CPU
2 GiB RAM
30 minute task timeout
max retries 1
```

The API invokes the Cloud Run Jobs v2 API with its attached runtime service-account identity. The dispatch payload overrides only:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

Repository state, GitHub credentials, approval state, AI credentials, CI state, and progress are loaded from durable Supabase storage. Do not pass those secrets through Cloud Run job overrides.

The runtime service account receives `roles/run.developer` on the specific completion-session Job so it can execute with overrides. Do not broaden that permission to project-wide administration unless there is a demonstrated requirement.

The worker keeps the existing completion-session lease/heartbeat protections and the API suppresses duplicate dispatch while a live/recent worker is detected. This protects against UI polling spawning duplicate paid executions or duplicate branch writes.

The worker also drains the existing bounded CI-repair background promise tracker before exiting. This is necessary because a Job has no HTTP server shutdown hook to keep repair work alive.

## Google Cloud deployment authentication

`.github/workflows/deploy-cloud-run.yml` authenticates GitHub Actions to Google Cloud through GitHub OIDC + Google Workload Identity Federation.

Do not add a long-lived service-account JSON private key to GitHub secrets.

Required non-secret GitHub repository variables:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
GCP_RUNTIME_SERVICE_ACCOUNT
```

`infra/gcp/bootstrap-cloud-run.sh` creates the recommended identities, Workload Identity provider, Artifact Registry repository, and required Secret Manager resources.

## Server secret roles

`SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY`
: Backend-only. Required for trusted service operations such as Vault RPCs. Never expose to browser code.

`PLAN_SIGNING_SECRET`
: Tamper-evident binding for generated change plans. Rotating it can invalidate in-flight plans.

`SECRET_ENCRYPTION_KEY`
: Used for server-sealed credentials such as stored GitHub connections. AI BYOK keys use Supabase Vault. Rotating this key without a credential migration can make old sealed envelopes unreadable.

During the compute-host migration, preserve the existing production values rather than generating replacements.

## Supabase

All schema changes belong in `supabase/migrations/`.

Production migration process:

1. Review SQL for destructive operations.
2. Confirm RLS/grants for all user-owned tables.
3. Confirm service-role-only functions are not executable by `anon` or `authenticated` unless explicitly intended.
4. Apply migration.
5. Query expected schema/policies/functions after apply.
6. Verify application deployment that depends on it.
7. Record the migration file in Git before calling the feature complete.

The Cloud Run infrastructure migration itself does not require a new database migration; it reuses existing durable completion-session and Vault state.

### Vault checks

AI BYOK storage should satisfy all of these:

- user preference row contains a Vault secret reference;
- no new plaintext AI key is stored in `custom_ai_key`;
- trusted server role can store/read/delete through the RepoFinisher RPCs;
- normal `anon` and `authenticated` roles cannot execute privileged Vault RPCs;
- browser responses expose provider/model/configured status but never the credential value.

## GitHub CI

`.github/workflows/ci.yml` is the required code gate.

It currently performs:

1. checkout;
2. non-Vercel hosting-policy enforcement;
3. pnpm setup;
4. Node setup;
5. frozen-lockfile install;
6. package tests;
7. typecheck + production build.

Do not merge around a red CI run. Inspect the failing job/log and fix the underlying problem.

## Cloud Run deployment workflow

`.github/workflows/deploy-cloud-run.yml` runs on manual dispatch and relevant pushes to `main` when the required Google Cloud repository variables exist.

Deployment order:

1. GitHub OIDC/WIF authentication;
2. build immutable SHA-tagged container;
3. push to Artifact Registry;
4. deploy/update Cloud Run completion-session Job;
5. ensure runtime identity can execute that Job with overrides;
6. deploy/update Cloud Run API service;
7. verify direct `/api/healthz`;
8. publish service/job/image summary.

A successful workflow does not by itself authorize the Netlify cutover. Test authenticated API behavior first.

## Production smoke

`.github/workflows/production-smoke.yml` runs `scripts/smoke-check.mjs` against:

- Netlify frontend;
- a user-supplied persistent API URL;
- Supabase.

The workflow's default API remains the Render rollback endpoint during migration so an accidental manual run does not falsely assume Cloud Run already exists. After Cloud Run deployment, supply the emitted Cloud Run URL explicitly. Once cutover is permanent, update the default in a follow-up change.

A smoke pass is seam evidence, not a replacement for authenticated product-flow tests.

## Release procedure

For a normal production-impacting change:

1. Create a focused branch.
2. Make the smallest coherent change.
3. Update relevant docs/config examples in the same branch.
4. Open a PR.
5. Obtain green CI.
6. Apply any required Supabase migration and verify it.
7. Merge only when the branch is coherent and green.
8. Verify Cloud Run deployment if backend/worker changed.
9. Verify Netlify deployment if frontend changed.
10. Run production smoke for material production changes.
11. Confirm authenticated user-visible behavior.
12. Record remaining blockers instead of declaring incomplete work finished.

For the initial Cloud Run cutover, follow `docs/CLOUD_RUN_MIGRATION.md` in addition to this procedure.

## DNS / endpoint cutover rule

Never point the canonical production frontend at a replacement API until that API has a successful deployment and direct-host smoke/auth evidence.

When moving the API host:

1. deploy replacement;
2. test replacement-host URL;
3. verify API/auth/CORS;
4. verify secret-backed GitHub and Vault credential reads;
5. change Netlify `VITE_API_BASE_URL`;
6. rebuild/redeploy Netlify;
7. verify canonical frontend;
8. run production smoke;
9. remove the old target only after rollback risk is understood.

## CORS

The API has an explicit first-party origin allowlist and may additionally use `CORS_ALLOWED_ORIGINS`.

When the frontend domain changes:

- update the API allowlist/config;
- do not use `*` for credentialed production requests;
- verify preflight and authenticated requests from the final canonical origin.

The compute host changing from Render to Cloud Run does not require loosening CORS.

## AI provider incident checklist

If Settings cannot save or use a provider/model:

1. Confirm frontend requests target the selected persistent API, not the Netlify SPA host.
2. Confirm the user session bearer token is present.
3. Confirm the provider is one of `google`, `openai`, `anthropic`, `openrouter`.
4. Confirm the exact model identifier is valid for the chosen provider.
5. Confirm the trusted Supabase backend key is available to the API/Job.
6. Confirm Vault RPCs exist and trusted role has execute permission.
7. Confirm `user_preferences.custom_ai_vault_secret_id` can be written for the authenticated user through the API flow.
8. Confirm no plaintext credential is returned or logged.
9. Test provider connectivity separately from persistence if the save succeeds but model invocation fails.
10. Confirm the platform key variable holds a real value and not whitespace. Blank values are treated as unconfigured.

### Reading a provider authentication failure

| Provider response | Meaning | Action |
| --- | --- | --- |
| `Missing Authentication header` | The request carried an empty bearer token. | The credential in use is blank. Set a real key. |
| `User not found.` / `Invalid API key` | A key was sent and the provider rejected it. | The key is wrong, revoked, or from another account. Rotate it. |
| `No auth credentials found` | No `Authorization` header reached the provider. | Integration bug — inspect the outbound request. |

RepoFinisher normalizes blank credentials to absent before provider calls. Seeing a provider-level missing-authentication error again indicates a credential path bypassed that normalization.

## Repository-finishing incident checklist

If runs are failing repeatedly:

1. Inspect reasoning trace and current evidence.
2. Inspect exact plan and approval/base SHA.
3. Inspect GitHub checks and Actions job logs.
4. Inspect deployment-preview evidence.
5. Inspect CI repair attempts and whether a repair was repeated.
6. Inspect completion-session lease/heartbeat and Cloud Run Job logs.
7. Inspect outcome telemetry and operational memories.
8. Confirm the provider/model is actually available and not quota/rate-limit exhausted.
9. Re-plan from current HEAD rather than replaying a stale plan.
10. Do not weaken acceptance criteria to force green.

If Cloud Run Jobs appear duplicated, verify the session heartbeat/lease timestamps and API scheduler logs before increasing concurrency or retries.

## Rollback principles

Application code
: Revert the merge commit or redeploy a known-good commit.

Frontend
: Roll back to a known-good Netlify deploy; do not redirect to Vercel.

API during Cloud Run migration
: Restore Netlify `VITE_API_BASE_URL` to the known-good Render API, redeploy Netlify, and run smoke. Leave failed Cloud Run resources/logs intact for diagnosis.

Cloud Run after migration
: Redeploy a known-good immutable container revision. Keep API and Job image compatibility in mind.

Database
: Prefer forward corrective migrations. Do not assume a schema migration is safely reversible unless a rollback was explicitly designed and tested.

Secrets
: Rotate exposed secrets when exposure occurred. Do not rotate `SECRET_ENCRYPTION_KEY` or `PLAN_SIGNING_SECRET` as a generic compute rollback action.

## Observability

When debugging production, correlate:

- Cloud Run service request/runtime logs;
- Cloud Run Job execution/task logs;
- Sentry events/traces when configured;
- GitHub Actions/check runs;
- RepoFinisher `completion_events`;
- `repo_completion_session_events`;
- `reasoning_traces`;
- `completion_repair_attempts`;
- `outcome_metrics`;
- `learning_memories`;
- product-readiness/assurance results.

Never log provider API keys, Supabase trusted backend credentials, GitHub tokens, private-key material, Vault decrypted secrets, or Google service-account private keys.
