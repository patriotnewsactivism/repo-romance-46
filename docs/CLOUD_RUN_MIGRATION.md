# RepoFinisher Cloud Run Migration

This runbook moves RepoFinisher's backend execution plane from Render to Google Cloud without using Vercel.

## Target topology

```text
Browser
  |
  v
Netlify frontend
  |
  v
Google Cloud Run API/control plane
  |             \
  |              \-> Cloud Run Job: completion-session worker
  |
  +-> Supabase: auth, database, RLS, Vault, durable session state
  +-> GitHub: repositories, branches, draft PRs, checks
  +-> OpenRouter / configured AI provider

GitHub Actions
  +-> CI/build/test
  +-> Workload Identity Federation -> Google Cloud deployment
```

The API is deliberately lightweight. Long-running finish-until-target work is dispatched to Cloud Run Jobs so repository reasoning, verification waits, and CI repair are not tied to an HTTP request lifetime.

Render stays available only as a temporary rollback target during cutover. Vercel is not part of this architecture.

## Why this split

The API service handles authentication, orchestration, status reads, repository metadata work, and job dispatch. Cloud Run can scale this control plane to zero when idle.

The completion-session worker runs with a larger CPU/memory allocation only while work exists. It reuses RepoFinisher's durable Supabase completion-session lease/state and can survive CI waiting/repair cycles without requiring a permanently large server.

GitHub Actions remains the source of truth for target-repository CI and build/test evidence. RepoFinisher does not need to host every target repository's build toolchain permanently in its API container.

## Source changes

The migration introduces:

- `artifacts/api-server/src/lib/cloud-run-jobs.ts` — metadata-identity based Cloud Run Jobs dispatch.
- `artifacts/api-server/src/lib/completion-session-scheduler.ts` — Cloud Run dispatch with duplicate-worker suppression and an in-process fallback.
- `artifacts/api-server/src/completion-session-job.ts` — Job entrypoint that keeps a durable completion session progressing through planning, execution, CI verification, bounded repair, and rescoring.
- `Dockerfile.apiserver` — shared API/worker image, Cloud Run port 8080.
- `.github/workflows/deploy-cloud-run.yml` — immutable image build + Cloud Run Job/API deploy through Workload Identity Federation.
- `infra/gcp/bootstrap-cloud-run.sh` — one-time Google Cloud bootstrap.

## Security model

Do not create or store a long-lived Google service-account JSON key for GitHub Actions. The deployment workflow uses GitHub OIDC + Google Workload Identity Federation.

Cloud Run receives sensitive values from Google Secret Manager. Required secret resources are:

```text
repofinisher-supabase-backend-key
repofinisher-secret-encryption-key
repofinisher-plan-signing-secret
```

The values must be the current production values during migration.

`SECRET_ENCRYPTION_KEY` must not be casually rotated during cutover. RepoFinisher uses it for server-sealed credentials such as stored GitHub connections; replacing it without a deliberate credential migration can make those values unreadable.

`PLAN_SIGNING_SECRET` should not be rotated while approved/in-flight plans exist because plan signatures are bound to that key.

AI BYOK values remain in Supabase Vault. They do not need to be copied into Google Secret Manager merely because the API host changes.

## One-time Google Cloud bootstrap

From an authenticated machine with `gcloud` installed:

```bash
chmod +x infra/gcp/bootstrap-cloud-run.sh
./infra/gcp/bootstrap-cloud-run.sh YOUR_GCP_PROJECT_ID us-central1
```

The script:

1. enables Cloud Run, Artifact Registry, IAM, IAM Credentials, STS, and Secret Manager APIs;
2. creates the `repofinisher` Docker Artifact Registry repository;
3. creates separate deploy and runtime service accounts;
4. grants the deploy identity only the deployment permissions it needs;
5. creates a GitHub Workload Identity pool/provider restricted to `patriotnewsactivism/repo-romance-46`;
6. creates the required Secret Manager secret resources;
7. grants the runtime/deploy identities secret access;
8. writes non-secret GitHub repository variables automatically when authenticated `gh` CLI is available, otherwise prints the exact variables to add.

The script intentionally does not accept, print, or commit application secret values.

## Add existing production secret values

Add current production values to the three Secret Manager resources from a trusted local shell or Google Cloud console. Do not paste them into source files, issues, pull requests, or chat.

Example local pattern:

```bash
printf %s "$SUPABASE_BACKEND_KEY" | gcloud secrets versions add repofinisher-supabase-backend-key --data-file=-
printf %s "$SECRET_ENCRYPTION_KEY" | gcloud secrets versions add repofinisher-secret-encryption-key --data-file=-
printf %s "$PLAN_SIGNING_SECRET" | gcloud secrets versions add repofinisher-plan-signing-secret --data-file=-
```

## Required GitHub repository variables

The deployment workflow expects:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
GCP_RUNTIME_SERVICE_ACCOUNT
```

Optional public configuration variables may also be set:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

No Google service-account private key is required.

## First deployment

Run GitHub Actions workflow:

```text
Deploy Cloud Run
```

The workflow performs this order:

1. authenticate to Google Cloud using Workload Identity Federation;
2. build one immutable SHA-tagged container image;
3. push the image to Artifact Registry;
4. deploy/update `repofinisher-completion-session` Cloud Run Job;
5. grant the runtime service account `roles/run.developer` on that specific job so it can execute the job with per-run environment overrides;
6. deploy/update `repofinisher-api` Cloud Run service;
7. verify the direct Cloud Run `/api/healthz` endpoint.

Do not cut over Netlify merely because the deployment step completed. Record the emitted Cloud Run API URL and test it directly first.

## Worker sizing

Initial deployment intentionally separates control and work:

- API service: 1 CPU / 1 GiB, concurrency 20, min instances 0, max instances 5.
- Completion-session Job: 2 CPU / 2 GiB, task timeout 30 minutes, max retries 1.

These are starting values, not permanent promises. Adjust from measured memory, CPU, duration, job failure, and queue behavior.

Because the job exists only while work is running, increasing worker memory later does not require paying for a large always-on API instance.

## Cloud Run Job execution contract

The API calls the Cloud Run v2 Jobs API using its attached runtime service-account identity. It passes only two per-execution values:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

The worker loads all durable state from Supabase. It does not accept repository code, provider secrets, or GitHub tokens through the job-dispatch payload.

The completion-session row retains the existing lease/heartbeat guard against duplicate branch writes. The API scheduler also suppresses duplicate dispatch while a recent worker lease/heartbeat exists.

A worker execution stays alive through ordinary CI verification and bounded repair cycles for up to roughly 27 minutes. If the Cloud Run task budget is reached while the durable session remains active, it exits cleanly; the session can be re-dispatched without replaying completed branch writes.

## Netlify cutover

Keep the existing Netlify frontend.

Only after direct Cloud Run API health and authenticated API behavior succeed:

1. set Netlify `VITE_API_BASE_URL` to the new Cloud Run API URL;
2. redeploy the frontend from current `main`;
3. verify `https://repofinisher.donmatthews.live` loads the new bundle;
4. verify CORS preflight from the canonical frontend origin;
5. verify authenticated Settings/BYOK save, reload, provider test, and remove;
6. create a real bounded completion session and confirm `workerMode` reports `cloud-run-job` on initial dispatch;
7. confirm the Cloud Run Job produces session/iteration events and draft-PR/CI progress;
8. run `.github/workflows/production-smoke.yml` with the Cloud Run API URL.

Do not delete or disable Render until those checks pass.

## Production acceptance

The migration is complete only when all of the following are true:

- CI on the migration commit is green.
- Cloud Run API direct health is green.
- Cloud Run API authenticated routes work with existing Supabase sessions.
- Existing stored GitHub credentials remain readable.
- Existing Vault-backed AI provider credentials remain usable.
- Netlify production bundle calls Cloud Run rather than Render.
- CORS succeeds for the canonical frontend.
- At least one real completion session executes through the Cloud Run Job worker.
- CI verification/repair state survives worker polling and no duplicate branch write occurs.
- Production smoke passes against Netlify + Cloud Run + Supabase.
- Sentry/Cloud logs contain no new material runtime failure.

## Rollback

Before final cutover, Render remains the rollback target.

If Cloud Run fails acceptance:

1. restore Netlify `VITE_API_BASE_URL` to the known-good Render API URL;
2. redeploy Netlify;
3. run production smoke against Render;
4. leave Cloud Run resources intact for diagnosis rather than deleting evidence;
5. fix the Cloud Run branch/workflow and repeat direct-host verification.

Supabase does not need to be rolled back merely because the compute host changes. No database migration is required for this infrastructure split.

## Cost controls

The architecture is intentionally usage-oriented:

- Cloud Run API can scale to zero.
- Heavy completion workers exist only while a session is actively running.
- GitHub Actions performs repository CI/build/test work instead of requiring a large permanent worker fleet.
- OpenRouter/provider usage remains independent of compute hosting.

Set Google Cloud billing budgets/alerts at the project level before enabling broad portfolio automation. A budget alert is not a hard spending cap, so RepoFinisher's own concurrency, iteration, and AI-cost limits remain important.
