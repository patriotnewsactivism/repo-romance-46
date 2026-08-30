# RepoFinisher Operations Guide

This is the production operations runbook for RepoFinisher.

For time-sensitive status read `docs/PROJECT_STATE.md` first. For the current Google Cloud deployment/cutover contract read `docs/CLOUD_RUN_MIGRATION.md`.

## Approved production stack

- Frontend: Google Cloud Run service `repofinisher-web`
- API/control plane: Google Cloud Run service `repofinisher-api`
- Long-running completion work: Google Cloud Run Job `repofinisher-completion-session`
- Auth/database/RLS/Vault/durable execution state: Supabase
- Source/CI/PR/check evidence/deployment automation: GitHub + GitHub Actions
- Image registry: Google Artifact Registry
- Backend compute secrets: Google Secret Manager
- Canonical custom-domain DNS: Cloudflare
- Observability: Sentry when configured + Cloud Run/Cloud Logging

**Do not deploy RepoFinisher to Vercel.**

Former Netlify/Render configuration is legacy migration/rollback material, not the current target architecture.

## Production endpoints

Canonical frontend:

```text
https://repofinisher.donmatthews.live
```

Known direct Cloud Run services in source/workflow:

```text
frontend: https://repofinisher-web-z6kubh2jtq-uc.a.run.app
API:      https://repofinisher-api-z6kubh2jtq-uc.a.run.app
```

Supabase project URL:

```text
https://rdsrxfzahhxbvugyarld.supabase.co
```

Direct service verification and canonical-domain verification are separate release gates.

## Cloud Run frontend

The frontend package is `@workspace/repo-finisher` in `artifacts/repo-finisher`. `Dockerfile.frontend` builds the SPA into the `repofinisher-web` container.

Required browser-build values:

```text
VITE_API_BASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Recommended observability values:

```text
VITE_SENTRY_DSN
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE
```

Build-only source-map upload may also use:

```text
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_RELEASE
```

Never prefix a private Sentry auth token with `VITE_`.

### Frontend acceptance

Before treating a frontend revision as production-ready:

1. immutable image builds from the intended commit;
2. direct Cloud Run service responds successfully;
3. built bundle points at the intended API URL;
4. SPA routes work;
5. login/session restoration works;
6. Settings can reach the API across origins;
7. provider status/save/remove/test behavior works when changed;
8. dashboard/repository views load;
9. mobile header/menu/theme contrast remains readable;
10. canonical custom domain serves the intended revision over HTTPS;
11. production smoke passes.

## Cloud Run API

Target service:

```text
repofinisher-api
```

The API package is `@workspace/api-server`. The API/worker image is built from `Dockerfile.apiserver` and listens on Cloud Run's injected `PORT`.

Important non-secret runtime values include:

```text
NODE_ENV=production
SUPABASE_URL
SUPABASE_ANON_KEY
CORS_ALLOWED_ORIGINS
LOG_LEVEL
NODE_OPTIONS=--enable-source-maps
CLOUD_RUN_JOBS_ENABLED=true
GCP_PROJECT_ID
GCP_REGION
COMPLETION_SESSION_JOB=repofinisher-completion-session
AI_PROVIDER
AI_MODEL / provider-specific model variables
SENTRY_ENVIRONMENT
SENTRY_RELEASE
SENTRY_TRACES_SAMPLE_RATE
```

Sensitive server values are injected through Google Secret Manager:

```text
SUPABASE_SECRET_KEY
SECRET_ENCRYPTION_KEY
PLAN_SIGNING_SECRET
```

User AI BYOK values remain in Supabase Vault; they are not copied to image build args, frontend environment, GitHub logs, or Cloud Run Job overrides.

### API sizing

Current workflow defaults are intentionally modest:

```text
1 CPU
1 GiB RAM
concurrency 20
min instances 0
max instances 5
```

Tune from measured latency, CPU, memory, request volume, and error data rather than guesswork.

## Completion-session worker

Target Job:

```text
repofinisher-completion-session
```

The worker uses the API/worker image with the completion-session entrypoint.

Current starting allocation:

```text
2 CPU
2 GiB RAM
30 minute task timeout
max retries 1
```

The API invokes the Cloud Run Jobs v2 API using its attached runtime service account. Per execution, only minimal identifiers such as these should be overridden:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

Repository state, GitHub credentials, AI credentials, approval state, branch state, CI state, progress, and repair history must be loaded from durable trusted storage.

The worker reuses completion-session lease/heartbeat guards and must not duplicate branch writes when a task retries or UI polling causes repeated scheduling attempts.

## Google Cloud deployment authentication

`.github/workflows/deploy-cloud-run.yml` authenticates GitHub Actions using GitHub OIDC + Google Workload Identity Federation.

Do not add a long-lived Google service-account JSON private key.

Expected non-secret GitHub repository variables include:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
GCP_RUNTIME_SERVICE_ACCOUNT
```

Public Supabase build configuration may also be supplied as repository variables where the workflow expects it.

`infra/gcp/bootstrap-cloud-run.sh` is the one-time bootstrap tooling for APIs, Artifact Registry, IAM identities, Workload Identity Federation, and Secret Manager resources.

## Secret roles

`SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY`
: Backend-only trusted Supabase privilege for service operations such as Vault RPCs. Never expose to browser code.

`PLAN_SIGNING_SECRET`
: Tamper-evident binding for generated change plans. Rotating it can invalidate in-flight approvals.

`SECRET_ENCRYPTION_KEY`
: Protects server-sealed credentials such as stored GitHub connections. AI BYOK values use Supabase Vault. Rotating without a migration can make historical envelopes unreadable.

During infrastructure migration or rollback, preserve existing production secret values unless performing an explicit credential migration.

## Supabase operations

All schema changes belong in `supabase/migrations/`.

Production migration process:

1. review SQL for destructive operations;
2. review RLS/policies;
3. review `security definer` and search-path behavior where applicable;
4. review grants/revokes for browser and trusted roles;
5. apply migration;
6. verify expected schema/policies/functions after apply;
7. verify dependent app behavior;
8. keep the migration file in Git.

### Vault acceptance

AI BYOK storage should satisfy:

- preferences row references a Vault secret when configured;
- no new plaintext AI key is stored in legacy columns;
- trusted backend can store/read/delete through RepoFinisher RPCs;
- normal browser roles cannot execute privileged Vault RPCs;
- API responses expose safe status/provider/model metadata but never the credential value.

## GitHub CI and deployment

`.github/workflows/ci.yml` is the required code gate.

It should verify:

- non-Vercel hosting policy;
- documentation topology consistency;
- frozen-lockfile install;
- package tests;
- typecheck/build.

`.github/workflows/deploy-cloud-run.yml` is the production deployment workflow. It should:

1. authenticate to Google Cloud through WIF;
2. build/push immutable API/worker and frontend images;
3. deploy/update the completion-session Job;
4. ensure runtime IAM can execute that specific Job;
5. deploy/update the API;
6. verify API directly;
7. deploy/update the frontend;
8. verify frontend directly;
9. audit required environment-variable names and canonical CORS;
10. create/update the custom-domain mapping;
11. update Cloudflare DNS only after direct surfaces are healthy;
12. verify the canonical custom domain;
13. publish a deployment summary.

A deployment step succeeding is not enough if later domain/runtime checks fail.

## Cloudflare/custom-domain operations

Canonical domain:

```text
repofinisher.donmatthews.live
```

The deployment workflow is allowed to reconcile the Cloud Run domain mapping and Cloudflare DNS when the required Cloudflare credentials are configured.

Rules:

- verify direct Cloud Run frontend/API first;
- do not delete working DNS before a replacement mapping has emitted usable records;
- keep Cloudflare API tokens in GitHub secrets, never repository files;
- verify certificate/HTTPS and actual served revision after DNS change;
- treat DNS propagation/certificate readiness as runtime state, not source-code success.

## Production smoke

Use `.github/workflows/production-smoke.yml` for external seam verification. The smoke test should cover the canonical frontend, selected API endpoint, and Supabase availability.

For material releases also test the relevant authenticated user journey, especially Settings/BYOK, repository analysis, finishing controls, and mobile navigation when touched.

## Monitoring

Primary signals:

- GitHub deployment workflow state;
- Cloud Run deployment/revision health;
- API `/api/healthz`;
- request latency/error rate;
- worker execution duration/failure/retry behavior;
- Sentry events when configured;
- Cloud Run/Cloud Logging;
- Supabase auth/database/RPC errors;
- completion-session leases/heartbeats and no-progress stops;
- provider-specific AI failures and quota/rate conditions.

## Rollback

Prefer a known-good Cloud Run revision/image over speculative production edits.

Before rolling back application code, determine whether a database migration makes the older revision incompatible. Use forward corrective migrations rather than destructive database rollback when possible.

If the canonical domain is wrong but direct Cloud Run service is healthy, fix the mapping/DNS seam instead of redeploying unrelated application code.

Legacy Render/Netlify infrastructure may only be used as a temporary emergency rollback if it is still available, known-good, securely configured, and the rollback decision is explicit. Never use Vercel as a fallback.

## Incident language

Use exact states:

- source fixed;
- PR merged;
- migration applied;
- image built;
- service/job deployed;
- direct runtime verified;
- canonical domain verified;
- authenticated user flow verified.

Do not collapse these into one word such as "fixed".

## Keeping this runbook current

Whenever deployment topology, service names, secret stores, domain management, worker execution, or release gates change, update this file in the same PR and update `docs/PROJECT_STATE.md` if the current rollout state changed.