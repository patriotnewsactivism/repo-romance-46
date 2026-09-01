# Incident Response Runbook

Use this runbook when RepoFinisher production is unavailable, unsafe, serving stale code, failing authenticated requests, exposing a security concern, or producing unreliable autonomous completion results.

## Severity guide

**SEV-1 — Security/data/control risk**

Examples: exposed credential, authorization/RLS bypass, unexpected repository writes, corrupted production data, autonomous merge/write outside approved scope.

**SEV-2 — Production unavailable or core workflow broken**

Examples: canonical frontend unavailable, API unavailable, authentication broken, Settings cannot persist required provider credentials, repository finishing cannot execute, completion-session workers repeatedly fail.

**SEV-3 — Degraded capability**

Examples: one AI provider unavailable, portfolio run degraded while direct finishing works, observability gaps, non-critical UI regression, slow but functioning worker execution.

## First actions

1. Stop further destructive/high-autonomy actions if safety is uncertain.
2. Preserve evidence: timestamps, commit SHA, workflow/deployment/revision IDs, affected route/run/session ID, redacted logs, domain/DNS state.
3. Determine which seam is failing: Cloud Run frontend, Cloud Run API, Cloud Run Job, Cloudflare/domain mapping, Supabase, GitHub, AI provider, or application logic.
4. Do not rotate/delete credentials or production data until the dependency is understood unless active exposure requires immediate rotation.
5. Record verified facts separately from inference.
6. Distinguish direct-host health from canonical-domain health.

## Cloud Run frontend diagnosis

Check:

- `repofinisher-web` current revision and source commit;
- direct Cloud Run frontend URL;
- container startup/serving logs;
- built `VITE_API_BASE_URL` target;
- Supabase browser variables;
- SPA routing;
- browser console/network errors;
- mobile header/menu/theme contrast if UI-only;
- whether the canonical domain serves the same expected revision.

A broken frontend must not be "fixed" by falling back to Vercel.

## Cloud Run API diagnosis

Check:

- `repofinisher-api` current revision/source commit;
- `/api/healthz` on the direct Cloud Run URL;
- Cloud Run request/application logs;
- required runtime variables and Secret Manager bindings;
- CORS for `https://portfolio.donmatthews.live`;
- Supabase bearer-token validation;
- runtime service-account identity/permissions;
- provider-specific failures separately from storage/auth failures.

Do not move long-running agent work back into a frontend/serverless request path as an outage workaround.

## Cloud Run Job diagnosis

For completion-session failures inspect:

- latest `repofinisher-completion-session` execution;
- source image SHA;
- task timeout/retry reason;
- runtime service-account permission to execute/read required resources;
- `REPOFINISHER_USER_ID` and `REPOFINISHER_SESSION_ID` overrides;
- durable session state, lease, heartbeat, iteration state, and stop reason;
- whether a prior execution already completed repository writes;
- bounded CI repair state and pending background repair work.

Never restart work by fabricating a new session if the existing durable session can safely resume. A retry must not duplicate branch writes.

## Cloudflare and custom-domain diagnosis

Canonical domain:

```text
portfolio.donmatthews.live
```

If direct Cloud Run frontend is healthy but the canonical domain is not:

1. inspect Cloud Run domain mapping target/status;
2. inspect emitted mapping DNS records;
3. inspect Cloudflare record type/content/proxy state;
4. verify certificate/HTTPS readiness;
5. compare DNS answers with the intended mapping;
6. fix only the mapping/DNS seam if application services are healthy.

Do not redeploy unrelated application code merely because DNS or certificate propagation is wrong.

## Supabase diagnosis

Check:

- project availability;
- auth/session failures;
- expected migration state;
- RLS/policies;
- trusted backend RPC permissions;
- Vault functions/references for BYOK;
- database errors/constraints;
- completion-session durable state and leases.

Never disable RLS broadly to make an incident disappear.

## AI provider / BYOK incident

If keys/models cannot save or run:

1. verify frontend request reaches `repofinisher-api`;
2. verify bearer token/session;
3. separate persistence failure from provider invocation failure;
4. verify provider/model contract;
5. verify trusted backend Vault RPC access;
6. verify preference row references a Vault secret when configured;
7. confirm API responses/logs contain no key material;
8. for quota/provider outage, preserve stored configuration and surface the provider-specific condition rather than deleting the key.

## Autonomous completion incident

If RepoFinisher generated unsafe, incorrect, or repeated work:

1. stop the affected run/session/portfolio item where possible;
2. preserve plan hash, base SHA, branch, PR, reasoning trace, repair attempts, CI evidence, worker execution ID, and outcome telemetry;
3. identify whether failure originated in evidence collection, diagnosis, planning, coding, validation, repair, worker scheduling, or learning;
4. do not weaken tests/checks to finish the run;
5. if an identical failed patch/strategy repeated, treat it as a learning/orchestration defect;
6. correct operational memory or prompt strategy only through measured evidence;
7. never mutate immutable safety policy to recover;
8. keep unrelated repositories isolated from the failed repository's rollback boundary.

## Suspected secret exposure

1. Remove the value from active logs/UI where possible.
2. Rotate/revoke the exposed credential at its provider.
3. Search repository/history/logs/issues/PRs for additional exposure.
4. Replace the production secret in the correct backend store: Google Secret Manager for compute-host secrets, Supabase Vault for user AI BYOK.
5. Do not consider deletion from the latest Git commit sufficient if the secret entered Git history.
6. Document root cause and add a prevention control/test when practical.

## Deployment rollback

Prefer a known-good Cloud Run revision/image over multiple speculative production edits.

Before rollback, determine whether database migrations make an application-only rollback incompatible. Prefer forward corrective database migrations over destructive rollback.

If only the canonical domain is broken while direct Cloud Run services are healthy, repair mapping/DNS rather than reverting application code.

Legacy Render/Netlify infrastructure may be used only as an explicit emergency rollback if it is still available, securely configured, and known-good. Record the rollback decision and follow-up retirement plan.

**Never use Vercel as an emergency fallback.**

## GitHub deployment workflow failure

If `.github/workflows/deploy-cloud-run.yml` fails:

- identify the exact failed step;
- do not describe deployment as complete because earlier image/service steps passed;
- preserve workflow/job logs;
- distinguish authentication, image build, Job deploy, API deploy, frontend deploy, env-contract audit, domain mapping, DNS, and canonical-domain verification failures;
- fix the failing stage and re-run through the remaining acceptance gates.

A workflow that fails after API deploy may still have changed production. Inspect actual revision/domain state before deciding rollback.

## Communication/status language

Use precise states:

- source fixed;
- PR merged;
- migration applied;
- image built;
- service/job deployed;
- direct runtime verified;
- canonical domain verified;
- authenticated user flow verified.

Do not collapse these into "fixed" when later layers remain unverified.

## Closure criteria

An incident closes only when:

- immediate impact is contained;
- root cause is known to reasonable confidence;
- production behavior is verified at the affected seam;
- security/data concerns are resolved;
- regression prevention is added where practical;
- docs/project state are updated when architecture/operating assumptions changed;
- autonomous-learning impact is recorded when applicable;
- temporary rollback routing is either retired or explicitly tracked.