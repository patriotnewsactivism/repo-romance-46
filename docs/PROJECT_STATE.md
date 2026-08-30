# RepoFinisher Project State

**Snapshot date:** 2026-08-30

This file is intentionally time-sensitive. Update it whenever production hosting, core completion behavior, security storage, or major implementation priorities change. Verify current code/deployments before relying on this snapshot for an irreversible action.

## Canonical source

Repository: `patriotnewsactivism/repo-romance-46`

Default branch: `main`

At the start of the Cloud Run migration work, `main` was:

```text
3e6da71c949c907fd4d20a1a25e3dab9aa67e8da
Merge pull request #87 — Fix OpenRouter 401 by treating blank credentials as unconfigured
```

`main` is branch-protected and requires the `CI` status check for non-admin merges.

The Cloud Run migration is being prepared on `infra/cloud-run-control-worker`. Do not describe the Google Cloud cutover as production-complete until that branch/PR is green, merged, deployed, and the acceptance checks below pass.

## Approved production architecture

Target architecture:

- Netlify — frontend SPA
- Google Cloud Run — persistent API/control plane
- Google Cloud Run Jobs — long-running finish-until-target completion workers
- GitHub Actions — CI/build/test and deployment workflow
- Supabase — authentication, database, RLS, Vault, durable completion state
- GitHub — source, branches, draft PRs, checks, repository evidence
- Sentry + Cloud Run/Cloud Logging — observability

Vercel is not an approved deployment target and must not be used for RepoFinisher.

### Migration status

The existing Render API remains the known rollback target during migration:

```text
https://repofinisher-api-live.onrender.com
```

The production Netlify frontend must continue using the known-good API until the Cloud Run API has passed direct-host health/auth checks. Render must not be removed merely because Cloud Run infrastructure code exists.

See `docs/CLOUD_RUN_MIGRATION.md` for the cutover procedure.

## Cloud Run implementation prepared in source

The migration branch includes:

- one shared API/worker container image;
- Cloud Run-compatible port 8080;
- a dedicated `completion-session-job` entrypoint;
- API dispatch to the Cloud Run Jobs v2 API using the attached Google runtime identity;
- per-job `REPOFINISHER_USER_ID` and `REPOFINISHER_SESSION_ID` overrides only;
- durable Supabase state rather than passing GitHub/provider credentials through job payloads;
- duplicate-worker suppression using existing session leases/heartbeats;
- worker polling through planning, execution, verification, bounded repair, and rescoring;
- explicit draining of existing CI-repair background promises inside the Job process;
- an in-process fallback when Cloud Run Jobs is not configured, preserving development and migration continuity;
- GitHub Actions deployment using Google Workload Identity Federation rather than a static service-account key;
- a one-time GCP bootstrap script for APIs, Artifact Registry, IAM identities, WIF, and Secret Manager resources.

Initial sizing in the deployment workflow:

```text
API: 1 CPU / 1 GiB / concurrency 20 / min instances 0 / max instances 5
completion-session Job: 2 CPU / 2 GiB / 30 minute task timeout
```

These are starting limits and should be tuned from measured workload data.

## Required one-time production setup still pending

Before the first Cloud Run deployment, the Google Cloud project must be bootstrapped and existing production backend secrets must be placed into Google Secret Manager.

Required Secret Manager resources:

```text
repofinisher-supabase-backend-key
repofinisher-secret-encryption-key
repofinisher-plan-signing-secret
```

Do not put their values in the repository, GitHub issues/PRs, or chat.

The migration must preserve the current `SECRET_ENCRYPTION_KEY`; changing it during cutover can make existing server-sealed GitHub credentials unreadable. Preserve the current `PLAN_SIGNING_SECRET` while approved plans are in flight.

AI BYOK credentials remain in Supabase Vault and do not need to be copied into Google Secret Manager merely because compute moves to Google Cloud.

## Frontend / Netlify state requiring verification

A Netlify project named `repofinisher` has previously been identified. The intended canonical product domain is:

```text
https://repofinisher.donmatthews.live
```

A prior checkpoint reported a `repofinish` versus `repofinisher` hostname discrepancy. Treat that as unresolved until the live Netlify domain configuration is verified directly.

During Cloud Run cutover:

1. keep the frontend on Netlify;
2. do not change `VITE_API_BASE_URL` until the Cloud Run direct URL passes health/auth checks;
3. then point `VITE_API_BASE_URL` at Cloud Run and redeploy Netlify;
4. verify canonical HTTPS domain, CORS, authenticated Settings/BYOK, dashboard/repository flows, and mobile menu/theme contrast;
5. run production smoke against Netlify + Cloud Run + Supabase.

## AI provider / BYOK state

Source supports:

- Google
- OpenAI
- Anthropic
- OpenRouter

Preferences support an explicit provider and exact model identifier. New AI BYOK credentials use Supabase Vault and are read only through the trusted server path. Browser responses must never contain decrypted credentials.

The preferred inexpensive platform route remains OpenRouter with the configured DeepSeek model when available, while users can supply their own provider/model credentials through Vault-backed Settings.

## Reasoning, completion, and learning state

Implemented foundations include:

- multi-stage repository evidence analysis;
- competing root-cause hypotheses;
- skeptical/verification critic;
- dynamically selected specialists;
- principal-plan synthesis;
- durable repo-local and cross-repo operational memory;
- measured outcome scoring;
- controlled prompt-strategy experiments;
- reasoning traces/audit data;
- reasoned bounded CI repair;
- direct-run and Finish Portfolio self-healing parity;
- external LLM completion prompts;
- continuous repository event reasoning;
- portfolio relationship analysis;
- product/security assurance runs;
- durable multi-iteration finish-until-target completion sessions.

The finish-until-target controller now has the core loop in source:

```text
reason -> implement -> verify -> repair if bounded/safe -> rescore
   -> still below target?
   -> reason again from fresh evidence
   -> next bounded iteration
```

The Cloud Run migration's purpose is to give this controller a proper execution plane rather than forcing long-running work to live inside the API service.

Learning means measured operational memory and strategy adaptation. It is not autonomous model-weight retraining.

## Highest-priority remaining work

### 1. Merge and deploy the Cloud Run migration

Required evidence:

- migration PR CI green;
- GCP bootstrap complete;
- Secret Manager values installed securely;
- Cloud Run Job and API deployed from the same immutable image;
- `/api/healthz` green on direct Cloud Run URL;
- authenticated routes work against existing Supabase production state.

### 2. Prove a real completion session through Cloud Run Jobs

Create a bounded completion session and confirm:

- API reports Cloud Run job dispatch rather than in-process fallback;
- only one paid worker is active despite UI polling;
- session lease/heartbeat behavior prevents duplicate branch writes;
- planning/execution creates or updates the expected draft PR;
- pending CI is polled without losing durable state;
- bounded CI repair completes inside the Job execution when needed;
- completion/readiness is rescored and another iteration occurs only when policy requires it.

### 3. Cut Netlify over to Cloud Run

After direct API verification, update `VITE_API_BASE_URL`, redeploy Netlify, run production smoke, then exercise authenticated Settings and repository workflows.

### 4. Retire Render only after rollback risk is cleared

Do not delete Render until Netlify + Cloud Run + Supabase production acceptance is complete. Once stable, remove Render-specific configuration/documentation and cancel the service if no other workload needs it.

### 5. Extend the worker plane beyond completion sessions

After the first worker path is proven, identify other long-running operations that should leave the API process, especially large portfolio reasoning, repository-specific acceptance/browser work, and other execution tasks whose duration or memory profile is unsuitable for request-serving instances.

### 6. Product-specific acceptance depth

Generic assurance can inspect repository, CI, deployment, and live-surface evidence. Products involving login, payments, privileged operations, native/mobile flows, or complex state still need stronger application-specific acceptance definitions and runtime/browser evidence before RepoFinisher should call them complete.

## Completed major foundations

Substantial capabilities already present include:

- Repo Investment Intelligence and adaptive finishing
- measured post-run rescoring
- full portfolio value and one-click finishing foundations
- large-portfolio analysis
- Finish Portfolio orchestration foundations
- direct and portfolio bounded self-healing CI
- tiered portfolio intelligence
- mobile/dark-theme contrast hardening
- deployment sandbox verification
- confidence-adjusted portfolio valuation
- controlled prompt evolution and specialist agents
- Reasoning & Learning OS schema/APIs
- portfolio consolidation graph
- security/product assurance
- continuous repository watch/event reasoning
- external LLM completion handoffs
- provider/model Settings including OpenRouter
- Supabase Vault-backed AI BYOK storage
- provider-neutral background runtime
- durable finish-until-target sessions
- Netlify frontend configuration
- non-Vercel CI hosting guard
- production seam smoke workflow

## Production completion standard

Do not mark the infrastructure migration complete based on a commit, PR, or successful Cloud Run deployment alone.

Use `docs/DEFINITION_OF_DONE.md`. For this migration, material evidence includes:

- code merged;
- Cloud Run deployment healthy;
- existing secrets/credentials still readable through the new runtime;
- Netlify production bundle calling Cloud Run;
- authenticated user paths verified;
- at least one real completion-session Job verified end-to-end;
- production smoke green;
- no known material rollback blocker.

## Recommended execution order

1. Get the Cloud Run migration PR green and merged.
2. Run the one-time GCP bootstrap.
3. Install existing production secret values in Secret Manager without exposing them.
4. Deploy Cloud Run Job + API through GitHub Actions/WIF.
5. Verify direct Cloud Run health/auth/credential behavior.
6. Point Netlify `VITE_API_BASE_URL` to Cloud Run and redeploy.
7. Run production smoke and authenticated Settings acceptance.
8. Run at least one real finish-until-target session through the Cloud Run Job.
9. Observe CPU/memory/duration/error data and tune worker sizing/concurrency.
10. Retire Render only after rollback is no longer needed.

## Updating this file

When a priority is completed:

- identify the implementing PR/commit;
- state whether deployment/runtime/user-flow verification actually occurred;
- remove obsolete warnings instead of accumulating contradictions;
- move newly discovered gaps into the priority register with evidence;
- keep secret values out of this file.
