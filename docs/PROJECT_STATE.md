# RepoFinisher Project State

**Snapshot date:** 2026-08-30

This file is intentionally time-sensitive. Update it whenever production hosting, core completion behavior, security storage, or major implementation priorities change. Verify current code/deployments before any irreversible action.

## Canonical source

Repository:

```text
patriotnewsactivism/repo-romance-46
```

Default branch: `main`

Snapshot head:

```text
6ae2324e081f03dab59221c7c27b89fcb7eee929
Merge pull request #99 — fix: complete Cloud Run custom-domain cutover
```

`main` is branch-protected and requires the `CI` status check for non-admin merges.

The source now contains the full Cloud Run frontend/API/worker deployment topology. However, **the canonical custom-domain cutover is not yet runtime-verified complete** because the latest deployment workflow failed at the domain-mapping/DNS stage after the three Cloud Run compute surfaces had already deployed successfully.

## Canonical production architecture

Source-of-truth target/runtime topology:

- Google Cloud Run `repofinisher-web` — frontend SPA
- Google Cloud Run `repofinisher-api` — API/control plane
- Google Cloud Run Job `repofinisher-completion-session` — long-running finish-until-target workers
- GitHub Actions — CI/build/test and Google Cloud deployment
- Google Artifact Registry — immutable API/worker and frontend images
- Google Secret Manager — backend compute-host secrets
- Supabase — authentication, database, RLS, Vault, durable completion state
- GitHub — source, branches, draft PRs, checks, repository evidence
- Cloudflare — canonical custom-domain DNS
- Sentry + Cloud Run/Cloud Logging — observability when configured

**Vercel is not an approved deployment target and must not be used.**

Former Netlify/Render infrastructure is legacy migration/rollback material, not the canonical runtime. Do not silently route production back to it.

## Known direct Cloud Run endpoints

Source/deployment workflow currently uses:

```text
API:      https://repofinisher-api-z6kubh2jtq-uc.a.run.app
Frontend: https://repofinisher-web-z6kubh2jtq-uc.a.run.app
```

Canonical custom domain intended:

```text
https://repofinisher.donmatthews.live
```

Supabase:

```text
https://rdsrxfzahhxbvugyarld.supabase.co
```

## Latest Cloud Run deployment evidence

GitHub Actions workflow:

```text
Deploy Cloud Run
run: 33326728811
head: 6ae2324e081f03dab59221c7c27b89fcb7eee929
result: failure
```

The workflow result is **not** a blanket compute-deployment failure. The following stages succeeded before the final failure:

- GitHub OIDC / Workload Identity Federation authentication;
- API/worker image build and Artifact Registry push;
- frontend image build and Artifact Registry push;
- `repofinisher-completion-session` Job deployment;
- runtime IAM binding allowing the API identity to execute the specific Job;
- `repofinisher-api` deployment;
- direct API `/api/healthz` verification;
- `repofinisher-web` deployment;
- direct frontend verification;
- deployed API/Job environment-contract audit, including required variable names and canonical CORS.

The failure occurred at:

```text
Ensure custom domain mapping and update Cloudflare DNS
```

The domain step invoked `gcloud beta run domain-mappings`. Although an earlier workflow step had installed the beta component, the later invocation still attempted an interactive beta-component installation and failed because GitHub Actions is non-interactive:

```text
ERROR: (gcloud) This prompt could not be answered because you are not in an interactive session.
```

Consequences:

- Cloud Run Job/API/frontend were deployed at this SHA and their direct service checks passed.
- Canonical custom-domain/DNS cutover was **not** completed by that run.
- `Verify canonical custom domain` was skipped.
- Do not claim `repofinisher.donmatthews.live` is serving the new Cloud Run frontend until the mapping/DNS workflow is fixed and verified.

## Current Google Cloud deployment contract

`.github/workflows/deploy-cloud-run.yml` builds two immutable SHA-tagged images:

```text
repofinisher-api
repofinisher-web
```

The API image also powers the completion-session Job.

Current starting resource settings in workflow:

```text
API:    1 CPU / 1 GiB / concurrency 20 / min 0 / max 5
Web:    1 CPU / 512 MiB / concurrency 80 / min 0 / max 3
Worker: 2 CPU / 2 GiB / 30 minute task timeout / max retries 1
```

These are starting limits, not permanent guarantees. Tune them from measured CPU/memory/duration/error/queue behavior.

The deployment workflow uses Google Workload Identity Federation. Do not introduce a long-lived Google service-account JSON key.

Backend compute secrets come from Google Secret Manager resources including:

```text
repofinisher-supabase-backend-key
repofinisher-secret-encryption-key
repofinisher-plan-signing-secret
```

AI BYOK credentials remain in Supabase Vault.

## AI provider / BYOK state

Source supports:

- Google
- OpenAI
- Anthropic
- OpenRouter

Preferences support explicit provider and exact model identifier. New user BYOK credentials use Supabase Vault and are read only through trusted backend code. Browser responses must never contain decrypted provider keys.

The platform fallback is configured in the current deployment workflow for OpenRouter with the selected DeepSeek model when a platform OpenRouter key is present. User BYOK/provider-model settings can override platform fallback behavior through the trusted path.

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
- product/security assurance;
- durable multi-iteration finish-until-target completion sessions;
- Cloud Run Job scheduler/worker execution plane.

The intended iterative loop is:

```text
reason -> implement -> verify -> bounded repair if justified -> rescore
   -> still below target and safe to continue?
   -> reason again from fresh evidence
   -> next bounded iteration
```

Learning means measured operational memory and strategy adaptation. It is not autonomous model-weight retraining.

## Highest-priority remaining work

### 1. Fix and verify the custom-domain deployment stage

The immediate infrastructure blocker is the non-interactive `gcloud beta run domain-mappings` failure in workflow run `33326728811`.

Required completion evidence:

- domain-mapping command no longer attempts an interactive component prompt;
- deployment workflow proceeds through mapping/DNS stage;
- Cloudflare DNS is updated to the emitted Cloud Run mapping records;
- `https://repofinisher.donmatthews.live` serves the intended current Cloud Run frontend over HTTPS;
- canonical-domain verification step passes.

Do not work around this by deploying to Vercel.

### 2. Run production smoke and authenticated acceptance on the canonical domain

After the domain cutover succeeds:

- run production smoke against canonical frontend + Cloud Run API + Supabase;
- verify login/session restoration;
- verify Settings provider/model save/reload/test/remove and Vault behavior;
- verify repository/dashboard/analysis flows;
- verify mobile header/menu/theme contrast;
- verify no frontend request incorrectly targets its own static host for API routes.

### 3. Prove a real completion session through Cloud Run Jobs

Create a bounded finish-until-target session and verify:

- API reports Cloud Run Job dispatch rather than in-process fallback;
- only one active worker proceeds despite UI polling/retry;
- lease/heartbeat protects against duplicate branch writes;
- planning/execution creates or updates the expected draft PR;
- CI waits remain durable;
- bounded repair completes safely when needed;
- completion/readiness is rescored;
- another iteration occurs only when targets/policy require it;
- worker retry/re-dispatch resumes state rather than replaying completed writes.

### 4. Retire obsolete rollback infrastructure after acceptance

Once Cloud Run frontend/API/Job + canonical domain + authenticated acceptance are stable, determine whether legacy Render/Netlify resources/configuration still have a justified rollback purpose.

Do not delete rollback evidence prematurely, but do not leave obsolete infrastructure indefinitely without ownership/purpose.

### 5. Extend product-specific acceptance depth

Generic assurance covers repository, CI, deployment, and live-surface evidence. Apps involving login, payments, privileged operations, native/mobile flows, webhooks, or complex state still need stronger application-specific acceptance definitions and runtime/browser evidence before RepoFinisher should call them complete.

### 6. Continue reliability/performance hardening

Known non-fatal build warnings remain:

- API bundle approximately 4.4 MB;
- completion-session worker bundle approximately 1.3 MB;
- frontend production JS approximately 941 kB with a >500 kB chunk warning;
- recurring sourcemap warnings in shared UI components such as tooltip/label/select/collapsible/dropdown-menu.

These are not the current domain-cutover blocker but should remain visible as maintainability/performance debt.

## Completed major foundations

Substantial capabilities now in source include:

- Repo Investment Intelligence and adaptive finishing;
- measured post-run rescoring;
- full portfolio value and one-click finishing foundations;
- large-portfolio/tiered analysis;
- Finish Portfolio orchestration;
- direct and portfolio bounded self-healing CI;
- mobile/dark-theme contrast hardening;
- deployment sandbox verification;
- confidence-adjusted portfolio valuation;
- controlled prompt evolution and specialist agents;
- Reasoning & Learning OS schema/APIs;
- portfolio consolidation graph;
- security/product assurance;
- continuous repository event reasoning;
- external LLM completion handoffs;
- explicit provider/model Settings including OpenRouter;
- Supabase Vault-backed AI BYOK storage;
- durable finish-until-target sessions;
- Cloud Run frontend/API/Job source and deployment workflow;
- Workload Identity Federation deployment authentication;
- Artifact Registry and Secret Manager integration;
- non-Vercel CI hosting guard;
- production seam smoke workflow;
- Cloudflare custom-domain automation in source.

## Production completion standard

Do not mark the infrastructure cutover complete based on source code, a merged PR, or successful direct Cloud Run deployment alone.

For the current cutover, material evidence includes:

- CI green on the release commit;
- Cloud Run Job/API/frontend deployment healthy;
- direct API/frontend verification green;
- existing sealed GitHub credentials and Vault-backed AI credentials remain usable;
- runtime environment/secret contract verified;
- Cloud Run domain mapping succeeds;
- Cloudflare DNS points to the intended mapping;
- canonical HTTPS domain verified;
- production smoke green;
- relevant authenticated user flows verified;
- at least one real completion-session Job verified end-to-end;
- no known material rollback blocker.

Use `docs/DEFINITION_OF_DONE.md` and `docs/RELEASE-CHECKLIST.md`.

## Updating this file

When state changes:

- identify the implementing PR/commit/workflow run;
- state which layers were actually verified;
- remove obsolete warnings rather than accumulating contradictions;
- move newly discovered blockers into the priority register with evidence;
- keep secret values out of this file;
- distinguish source fixed, merged, deployed, direct runtime verified, canonical domain verified, and user-flow verified.