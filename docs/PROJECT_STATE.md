# RepoFinisher Project State

**Snapshot date:** 2026-09-01

This file is intentionally time-sensitive. Verify current code, GitHub Actions, and live runtime evidence before any irreversible action.

## Canonical source

Repository: `patriotnewsactivism/repo-romance-46`

Default branch: `main`

Verified `main` head at this snapshot:

```text
cf6af1e7cc9533f05d45cb782223a85fd5894ae1
Merge PR #111: harden canonical runtime regression checks
```

`main` is protected and requires the `CI` status check for non-admin merges.

## Canonical production architecture

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

Former Netlify/Render infrastructure is legacy migration/rollback material, not the canonical runtime.

## Verified production endpoints

```text
Canonical frontend: https://portfolio.donmatthews.live
Direct frontend:    https://repofinisher-web-z6kubh2jtq-uc.a.run.app
API:                https://repofinisher-api-z6kubh2jtq-uc.a.run.app
Supabase:           https://rdsrxfzahhxbvugyarld.supabase.co
```

The old hostname `repofinisher.donmatthews.live` is not canonical and its stale Cloud Run mapping has been removed.

## Latest Cloud Run deployment evidence

### Cloud Run deployment

GitHub Actions run `33555540458` completed successfully. It verified:

- Google Cloud authentication;
- immutable API and frontend image builds/pushes;
- completion-session worker Job deployment;
- worker IAM binding;
- API deployment and direct health check;
- frontend deployment and direct verification;
- deployed environment contract;
- Cloud Run custom-domain mapping;
- canonical custom-domain response;
- canonical API CORS;
- deployment summary.

### Canonical-domain repair and regression verification

GitHub Actions run `33556715971` completed successfully against `main` head `cf6af1e7cc9533f05d45cb782223a85fd5894ae1`.

Verified facts from that run:

```text
portfolio.donmatthews.live -> repofinisher-web in us-central1
DNS record emitted by Cloud Run: CNAME ghs.googlehosted.com.
```

The workflow also verified that no stale `repofinisher.donmatthews.live` Cloud Run mapping remains, reconciled API CORS to the real canonical frontend, and verified canonical frontend/API connectivity.

Most importantly, the workflow downloaded the JavaScript bundle actually served by `https://portfolio.donmatthews.live` and required the live bundle to contain all of:

- `GPT-5.6 Sol`
- `GPT-5.6 Terra`
- `All accessible repositories`

That live Settings-bundle verification passed.

## Deployment contract

`.github/workflows/deploy-cloud-run.yml` builds two immutable SHA-tagged images:

```text
repofinisher-api
repofinisher-web
```

The API image also powers the completion-session Job.

Current starting resource settings:

```text
API:    1 CPU / 1 GiB / concurrency 20 / min 0 / max 5
Web:    1 CPU / 512 MiB / concurrency 80 / min 0 / max 3
Worker: 2 CPU / 2 GiB / 30 minute task timeout / max retries 1
```

The deployment workflow uses Google Workload Identity Federation. Do not introduce a long-lived Google service-account JSON key.

Backend compute secrets come from Google Secret Manager. AI BYOK credentials remain in Supabase Vault.

## AI provider / Settings state

Source and the verified live frontend expose provider/model selection including OpenAI, Google, Anthropic, and OpenRouter. The live production bundle has been verified to contain GPT-5.6 Sol and GPT-5.6 Terra choices.

The Settings portfolio-scope control is verified in the live bundle to include `All accessible repositories`, backed by the product's bounded 1,000-repository maximum.

A live-bundle string check proves that the current production asset contains these controls. It does not by itself prove every authenticated Settings save/reload/provider-key flow, so authenticated acceptance remains a separate evidence gate.

## Highest-priority remaining work

### 1. Authenticated production smoke

Still verify on `https://portfolio.donmatthews.live`:

- login/session restoration;
- Settings provider/model save and reload;
- BYOK add/test/remove behavior through the trusted API/Vault path;
- repository/dashboard/analysis flows;
- mobile header/menu/theme behavior;
- no frontend request incorrectly targets the static web host for API routes.

### 2. Real Cloud Run completion-session proof

Run a bounded finish-until-target session and verify:

- API dispatches the Cloud Run Job rather than relying on in-process fallback;
- lease/heartbeat prevents duplicate branch writes;
- planning/execution creates or updates the expected draft PR;
- CI waits remain durable;
- bounded repair behaves safely when needed;
- completion/readiness is rescored;
- retries resume durable state rather than replaying completed writes.

### 3. Legacy infrastructure cleanup

After authenticated acceptance and a real completion-session Job are proven, determine whether old Netlify/Render artifacts still have a justified rollback purpose. Do not route production back to them merely because they remain in the repository.

### 4. Reliability/performance debt

Known non-fatal build warnings should remain visible until measured and addressed, including large bundle sizes and recurring sourcemap warnings. These do not invalidate the current canonical-domain verification.

## Completion-claim discipline

Current evidence supports these statements:

- source merged: **yes**
- Cloud Run compute deployed: **yes**
- canonical domain mapped to `repofinisher-web`: **yes**
- canonical HTTPS frontend runtime verified: **yes**
- canonical API CORS verified: **yes**
- live Settings production bundle contains Sol/Terra/All-repositories controls: **yes**
- authenticated Settings/user-flow acceptance: **not yet fully proven**
- real finish-until-target Cloud Run Job end-to-end acceptance: **not yet fully proven**

Do not collapse these states into a generic claim that the entire product is finished.

Use `docs/DEFINITION_OF_DONE.md` and `docs/RELEASE-CHECKLIST.md` for final completion evidence.