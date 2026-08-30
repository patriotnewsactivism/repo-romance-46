# RepoFinisher Cloud Run Deployment and Cutover Runbook

This document began as the Render-to-Cloud-Run migration plan. It is retained at the same path because existing links may depend on it, but it now describes the **full Cloud Run production topology, current cutover state, acceptance gates, and rollback procedure**.

Vercel is not part of this architecture and must not be used as a fallback.

## Target topology

```text
Browser
  |
  v
Cloudflare DNS -> repofinisher.donmatthews.live
  |
  v
Cloud Run service: repofinisher-web
  |
  v
Cloud Run service: repofinisher-api
  |                    \
  |                     \-> Cloud Run Job: repofinisher-completion-session
  |                              |
  |                              +-> GitHub REST / Actions / PRs / checks
  |                              +-> configured AI provider
  |
  +-> Supabase: Auth / DB / RLS / Vault / durable state
  +-> GitHub: repositories / branches / draft PRs / check evidence

GitHub Actions
  +-> CI/build/test
  +-> OIDC/WIF -> Google Cloud deployment
  +-> immutable Artifact Registry images
  +-> Secret Manager bindings
  +-> domain mapping + Cloudflare DNS reconciliation
```

Former Netlify/Render configuration is legacy rollback/migration material, not the canonical target runtime.

## Why this split

`repofinisher-api` is the request-serving control plane. Long-running finish-until-target work is dispatched to `repofinisher-completion-session`, which can use larger resources only while active and can survive HTTP request lifetimes by loading durable state from Supabase.

The frontend is also containerized and deployed to Cloud Run as `repofinisher-web`, keeping the production web/API build provenance tied to immutable Git SHAs and one deployment workflow.

GitHub Actions remains the source of truth for RepoFinisher release automation and for target-repository CI evidence.

## Key source files

- `artifacts/api-server/src/lib/cloud-run-jobs.ts` — metadata-identity Cloud Run Job dispatch.
- `artifacts/api-server/src/lib/completion-session-scheduler.ts` — dispatch and duplicate-worker suppression.
- `artifacts/api-server/src/completion-session-job.ts` — durable completion-session worker entrypoint.
- `Dockerfile.apiserver` — API/worker image.
- `Dockerfile.frontend` — production frontend image.
- `.github/workflows/deploy-cloud-run.yml` — image build, service/job deploy, environment audit, domain/DNS cutover.
- `infra/gcp/bootstrap-cloud-run.sh` — one-time APIs/IAM/WIF/Artifact Registry/Secret Manager bootstrap.

## Security model

GitHub Actions authenticates to Google Cloud through GitHub OIDC + Workload Identity Federation. Do not create/store a long-lived Google service-account JSON key.

Cloud Run backend secrets come from Google Secret Manager. Required production secret resources include:

```text
repofinisher-supabase-backend-key
repofinisher-secret-encryption-key
repofinisher-plan-signing-secret
```

`SECRET_ENCRYPTION_KEY` protects server-sealed credentials such as stored GitHub connections. Do not rotate it casually; an unplanned rotation can make previous envelopes unreadable.

`PLAN_SIGNING_SECRET` binds in-flight repository plans/approvals and should not be rotated without understanding that effect.

User AI BYOK values remain in Supabase Vault and are not copied into Google Secret Manager, frontend build args, Job overrides, or browser-visible configuration.

## One-time Google Cloud bootstrap

From a trusted authenticated environment with `gcloud`:

```bash
chmod +x infra/gcp/bootstrap-cloud-run.sh
./infra/gcp/bootstrap-cloud-run.sh repofinish us-central1
```

The bootstrap is intended to:

1. enable required Google APIs;
2. create the `repofinisher` Artifact Registry repository;
3. create separate deploy/runtime service accounts;
4. configure least-privilege deploy/runtime IAM;
5. create the GitHub Workload Identity pool/provider restricted to this repository;
6. create required Secret Manager resources;
7. grant intended secret access;
8. configure or print required non-secret GitHub variables.

It must not accept, print, or commit application secret values.

## Required GitHub configuration

Expected non-secret repository variables include:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
GCP_RUNTIME_SERVICE_ACCOUNT
```

Public build configuration may also include:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

The domain automation additionally requires a Cloudflare API token in GitHub secrets and may use a Cloudflare zone ID repository variable.

## Deployment order

`.github/workflows/deploy-cloud-run.yml` currently performs this sequence:

1. checkout source;
2. authenticate through WIF;
3. configure gcloud and Artifact Registry authentication;
4. build/push immutable API/worker image;
5. build/push immutable frontend image;
6. deploy/update `repofinisher-completion-session`;
7. grant runtime identity the required permission on that Job;
8. deploy/update `repofinisher-api`;
9. verify direct API health;
10. deploy/update `repofinisher-web`;
11. verify direct frontend response;
12. audit required API/Job environment-variable names and canonical CORS;
13. create/reconcile Cloud Run custom-domain mapping;
14. update Cloudflare DNS to the emitted mapping records;
15. verify the canonical HTTPS domain;
16. publish deployment summary.

Do not report the entire release successful if a late domain/DNS step fails after compute services deploy.

## Runtime configuration

Known direct URLs in the current workflow:

```text
API:      https://repofinisher-api-z6kubh2jtq-uc.a.run.app
Frontend: https://repofinisher-web-z6kubh2jtq-uc.a.run.app
```

Canonical domain:

```text
https://repofinisher.donmatthews.live
```

Current starting resources:

```text
API:
  1 CPU
  1 GiB
  concurrency 20
  min instances 0
  max instances 5

Frontend:
  1 CPU
  512 MiB
  concurrency 80
  min instances 0
  max instances 3

Completion-session Job:
  2 CPU
  2 GiB
  task timeout 30m
  max retries 1
```

Tune from measured resource/latency/error data rather than assumptions.

## Completion-session execution contract

The API calls the Cloud Run Jobs v2 API using its attached runtime identity.

Per execution, pass only minimal non-secret identifiers such as:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

The worker loads repository state, GitHub credentials, AI credentials, approvals, CI state, iteration progress, budgets, and repair history from trusted durable storage.

The session row retains lease/heartbeat protections. API scheduling also suppresses duplicate dispatch while a recent worker is active. A retried Job must resume state rather than repeat completed repository writes.

## Current cutover state — 2026-08-30

Current `main` snapshot when this runbook was reconciled:

```text
6ae2324e081f03dab59221c7c27b89fcb7eee929
PR #99 — fix: complete Cloud Run custom-domain cutover
```

Latest deployment workflow examined:

```text
run 33326728811
conclusion: failure
```

Successful stages in that run:

- API/worker image built/pushed;
- frontend image built/pushed;
- completion-session Job deployed;
- Job invocation IAM binding applied;
- API deployed;
- direct API health passed;
- frontend deployed;
- direct frontend verification passed;
- API/Job environment-contract audit passed.

Failure stage:

```text
Ensure custom domain mapping and update Cloudflare DNS
```

Observed root cause:

`gcloud beta run domain-mappings` attempted an interactive beta-component installation inside GitHub Actions, despite an earlier beta install step. GitHub Actions cannot answer that prompt, so the step exited with code 1. The canonical-domain verification step was consequently skipped.

Therefore the correct state is:

- **Cloud Run compute surfaces deployed/directly verified:** yes for this SHA;
- **canonical domain/DNS cutover verified:** no;
- **full production cutover complete:** no.

Fix the domain command non-interactive behavior, rerun deployment, and verify the canonical domain before changing this state.

## Custom-domain and Cloudflare contract

The deployment workflow may manage `repofinisher.donmatthews.live` only after direct frontend/API checks pass.

Safe order:

1. ensure/inspect Cloud Run mapping for `repofinisher-web`;
2. wait for Cloud Run to emit required DNS records;
3. resolve Cloudflare zone;
4. replace only the intended hostname records;
5. keep records DNS-only if required by the Cloud Run mapping/certificate path;
6. verify DNS resolution and HTTPS/certificate readiness;
7. fetch canonical frontend and confirm it serves the intended deployment marker/revision.

Do not delete working DNS before a replacement mapping has produced usable records.

## Production acceptance

The Cloud Run cutover is complete only when all applicable gates are satisfied:

- required CI is green;
- immutable images map to intended Git SHA;
- Cloud Run Job deployed;
- API direct health passes;
- frontend direct verification passes;
- environment/secret/CORS contract passes;
- existing sealed GitHub credentials remain usable;
- Vault-backed AI BYOK remains usable;
- domain mapping targets `repofinisher-web`;
- Cloudflare DNS matches mapping records;
- canonical HTTPS domain serves the intended frontend;
- production smoke passes;
- Settings/BYOK authenticated flow works;
- at least one real completion session executes through the Cloud Run Job worker;
- worker retry/lease behavior does not duplicate writes;
- logs/Sentry show no new material release failure.

## Rollback

Prefer rolling a Cloud Run service/Job back to a known-good immutable revision/image over speculative production edits.

Before application rollback, confirm database migrations are compatible with the older revision. Prefer forward corrective migrations over destructive database rollback.

If direct Cloud Run frontend is healthy but canonical domain is not, repair mapping/DNS instead of rolling back healthy application code.

Legacy Netlify/Render infrastructure may only be used as an explicit emergency rollback if it remains available, secure, and demonstrably known-good. Record the rollback and follow-up retirement plan in `docs/PROJECT_STATE.md`.

**Never roll back to Vercel.**

## Cost controls

The architecture is usage-oriented:

- API/frontend can scale to zero;
- heavier workers exist only while completion work runs;
- target-repository CI/build/test remains in GitHub Actions where appropriate;
- provider usage remains independently bounded;
- RepoFinisher's own concurrency/iteration/cost/risk limits remain necessary even when Google billing alerts exist.

Set project billing budgets/alerts, but do not mistake an alert for a hard application spending cap.

## Updating this runbook

When the current domain blocker is resolved, update both this file and `docs/PROJECT_STATE.md` with the successful workflow run/commit and the exact runtime gates that passed. Remove obsolete transitional language instead of accumulating contradictory topologies.