# RepoFinisher Operations Guide

This is the production-operations runbook for RepoFinisher.

For time-sensitive status, read `docs/PROJECT_STATE.md` first.

## Approved production stack

- Frontend: Netlify
- Persistent API: Render
- Auth/database/RLS/Vault: Supabase
- Source/CI/PRs: GitHub
- Observability: Sentry when configured

**Do not deploy RepoFinisher to Vercel.**

The API is intentionally persistent because repository analysis, reasoning councils, portfolio work, and bounded repair can exceed short synchronous serverless execution windows.

## Production endpoints

Intended canonical frontend:

```text
https://repofinisher.donmatthews.live
```

Persistent API:

```text
https://repofinisher-api-live.onrender.com
```

Supabase project URL:

```text
https://rdsrxfzahhxbvugyarld.supabase.co
```

Before changing DNS, verify the target host is healthy and read `docs/PROJECT_STATE.md` for current cutover state.

## Netlify frontend

`netlify.toml` is the repository-level frontend build definition.

Current build contract:

```text
command: pnpm --filter @workspace/repo-finisher typecheck && pnpm --filter @workspace/repo-finisher build
publish: artifacts/repo-finisher/dist/public
```

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
4. Settings can call the Render API across origins.
5. AI provider status/save/remove works.
6. Dashboard and repository views load.
7. Mobile header/menu contrast is readable.
8. No frontend API request falls back to the Netlify host when it should call Render.
9. Production smoke passes.

## Render API

The canonical service is `repofinisher-api-live` and should deploy from `main`.

The API package is `@workspace/api-server`.

Build/start behavior:

```bash
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```

Important server-side variables include:

```text
NODE_ENV=production
PORT
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PLAN_SIGNING_SECRET
SECRET_ENCRYPTION_KEY
CORS_ALLOWED_ORIGINS
LOG_LEVEL
```

Optional platform AI fallback credentials/models:

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

Sentry API configuration may include:

```text
SENTRY_DSN
SENTRY_ENVIRONMENT
SENTRY_TRACES_SAMPLE_RATE
```

### Server secret roles

`SUPABASE_SERVICE_ROLE_KEY`
: Backend-only. Required for trusted service operations such as Vault RPCs. Never expose to browser code.

`PLAN_SIGNING_SECRET`
: Tamper-evident binding for generated change plans. Rotating it can invalidate in-flight plans.

`SECRET_ENCRYPTION_KEY`
: Used for server-sealed legacy/current non-Vault secrets such as stored GitHub credentials. AI BYOK keys now use Supabase Vault. Rotating this key can make old sealed envelopes unreadable until users reconnect or the old key is restored.

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

### Vault checks

AI BYOK storage should satisfy all of these:

- user preference row contains a Vault secret reference,
- no new plaintext AI key is stored in `custom_ai_key`,
- service role can store/read/delete through the RepoFinisher RPCs,
- normal `anon` and `authenticated` roles cannot execute those privileged RPCs,
- browser responses expose provider/model/configured status but never the credential value.

## GitHub CI

`.github/workflows/ci.yml` is the required code gate.

It currently performs:

1. checkout,
2. non-Vercel hosting-policy enforcement,
3. pnpm setup,
4. Node setup,
5. frozen-lockfile install,
6. package tests,
7. typecheck + production build.

Do not merge around a red CI run. Inspect the failing job/log and fix the underlying problem.

## Production smoke

`.github/workflows/production-smoke.yml` runs `scripts/smoke-check.mjs` against:

- Netlify frontend,
- Render API,
- Supabase.

Use it after a production cutover or a material deployment/network/configuration change.

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
8. Verify Render deployment if backend changed.
9. Verify Netlify deployment if frontend changed.
10. Run production smoke for material production changes.
11. Confirm user-visible behavior.
12. Record remaining blockers instead of declaring incomplete work finished.

## DNS/cutover rule

Never point the canonical production domain at a replacement target until that target has a successful deployment and direct-host smoke evidence.

When moving hosts:

1. deploy replacement,
2. test replacement-host URL,
3. verify API/auth/CORS,
4. verify production variables,
5. switch DNS/domain association,
6. verify canonical URL,
7. remove old target only after rollback risk is understood.

## CORS

The API has an explicit first-party origin allowlist and may additionally use `CORS_ALLOWED_ORIGINS`.

When the frontend domain changes:

- update the API allowlist/config,
- do not use `*` for credentialed production requests,
- verify preflight and authenticated requests from the final canonical origin.

## AI provider incident checklist

If Settings cannot save or use a provider/model:

1. Confirm frontend requests target the Render API, not the Netlify SPA host.
2. Confirm the user session bearer token is present.
3. Confirm the provider is one of `google`, `openai`, `anthropic`, `openrouter`.
4. Confirm the exact model identifier is valid for the chosen provider.
5. Confirm `SUPABASE_SERVICE_ROLE_KEY` is available to the API.
6. Confirm Vault RPCs exist and service role has execute permission.
7. Confirm `user_preferences.custom_ai_vault_secret_id` can be written for the authenticated user through the API flow.
8. Confirm no plaintext credential is returned or logged.
9. Test provider connectivity separately from persistence if the save succeeds but model invocation fails.
10. Confirm the platform key variable holds a real value and not whitespace. A variable that exists but is blank is treated as unconfigured, exactly as if it were unset.

### Reading a provider authentication failure

A `401` from the provider names which side is at fault. Do not respond to all of them the same way.

| Provider response | Meaning | Action |
| --- | --- | --- |
| `Missing Authentication header` | The request carried an empty bearer token. | The credential in use is blank. Set a real key. |
| `User not found.` / `Invalid API key` | A key was sent and the provider rejected it. | The key is wrong, revoked, or from another account. Rotate it. |
| `No auth credentials found` | No `Authorization` header reached the provider. | Integration bug — inspect the outbound request. |

RepoFinisher normalizes blank credentials to "absent" before any provider call, so a blank key now fails with the API's own `AI provider "<provider>" has no configured API key` message rather than a provider `401`. Seeing `Missing Authentication header` from RepoFinisher again means a credential is reaching `callAI` without passing through `loadAiCredential`.

## Repository-finishing incident checklist

If runs are failing repeatedly:

1. Inspect reasoning trace and current evidence.
2. Inspect exact plan and approval/base SHA.
3. Inspect GitHub checks and Actions job logs.
4. Inspect deployment-preview evidence.
5. Inspect CI repair attempts and whether a repair was repeated.
6. Inspect outcome telemetry and operational memories.
7. Confirm the provider/model is actually available and not quota/rate-limit exhausted.
8. Re-plan from current HEAD rather than replaying a stale plan.
9. Do not weaken acceptance criteria to force green.

## Rollback principles

Application code
: Revert the merge commit or redeploy a known-good commit on the current approved host.

Frontend
: Roll back to a known-good Netlify deploy; do not redirect to Vercel.

API
: Roll back/redeploy a known-good Render commit.

Database
: Prefer forward corrective migrations. Do not assume a schema migration is safely reversible unless a rollback was explicitly designed and tested.

Secrets
: Rotate exposed secrets. Do not attempt to “roll back” a credential exposure by only reverting code.

## Observability

When debugging production, correlate:

- Render request/app logs,
- Sentry events/traces when configured,
- GitHub Actions/check runs,
- RepoFinisher `completion_events`,
- `reasoning_traces`,
- `completion_repair_attempts`,
- `outcome_metrics`,
- `learning_memories`,
- product-readiness/assurance results.

Never log provider API keys, Supabase service-role credentials, GitHub tokens, private-key material, or Vault decrypted secrets.

## Capacity

RepoFinisher's API performs CPU/network-heavy multi-step orchestration and should not be treated like a tiny static API. A free or heavily constrained instance can introduce cold starts and poor reliability for portfolio work. Capacity should be monitored and raised as real usage grows.

## Decommissioning obsolete services

Only one canonical production API service should remain after migration verification. Old services/branches should be retired after:

- canonical service is healthy,
- environment/config parity is confirmed,
- no frontend points to the old service,
- rollback is still possible through source history/deploy history.

Do not leave ambiguous production endpoints indefinitely.