# RepoFinisher Operations Runbook

## Production topology

- Frontend: Netlify
- API: Render (`repofinisher-api-live`)
- Database/Auth/Vault: Supabase
- Source/CI: GitHub
- Optional observability: Sentry

Vercel is not an approved production target.

## Release flow

For production-impacting changes:

1. Create a focused branch from current `main`.
2. Make the change and update docs/migrations in the same branch when required.
3. Run tests/typecheck/build locally when possible.
4. Open a PR.
5. Require green GitHub Actions CI.
6. Merge only after the reviewed/tested head SHA is known.
7. Allow Render to deploy the merged `main` API commit.
8. Deploy the frontend to Netlify from the same current `main`.
9. Run the provider-neutral production smoke workflow against Netlify + Render + Supabase.
10. Exercise any feature-specific production path affected by the change.

Do not call a release complete merely because a hosting provider reports `deployed` or `ready`.

## CI

The required CI workflow is `.github/workflows/ci.yml`.

It currently performs the equivalent of:

```bash
pnpm install --frozen-lockfile
pnpm -r --if-present test
pnpm build
```

The root build performs typechecking before package builds.

CI also blocks known Vercel hosting artifacts. Extend that guard if additional old Vercel deployment files are discovered.

## Production smoke test

`.github/workflows/production-smoke.yml` is manually dispatchable and verifies the production seams.

Expected production endpoints:

- frontend: `https://repofinisher.donmatthews.live`
- API: `https://repofinisher-api-live.onrender.com`
- Supabase: the production project URL configured for RepoFinisher

A smoke failure must be investigated before considering a cutover or release healthy.

## Netlify frontend

`netlify.toml` is the source-controlled frontend build definition.

Current build intent:

```text
command: pnpm --filter @workspace/repo-finisher typecheck && pnpm --filter @workspace/repo-finisher build
publish: artifacts/repo-finisher/dist/public
```

Required browser build configuration:

- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SENTRY_ENVIRONMENT` (recommended)
- `VITE_SENTRY_DSN` (optional/recommended)

Never place private credentials in `VITE_*` variables. Vite embeds them into browser assets.

SPA routing must continue to send non-static routes to `index.html`.

## Render API

The persistent API is responsible for workloads that may exceed short synchronous serverless request limits, including deep analysis, portfolio work, repair, and multi-agent reasoning.

Backend-only configuration includes or may include:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ALLOWED_ORIGINS`
- `SECRET_ENCRYPTION_KEY` (still required for sealed GitHub connection tokens)
- `PLAN_SIGNING_SECRET`
- platform AI provider keys/models
- server-side Sentry configuration

Do not duplicate private backend credentials into Netlify.

## Supabase migrations

Production schema changes live under `supabase/migrations/`.

Rules:

1. Add a new forward migration; do not edit applied history.
2. Review RLS/grants for every new table/function.
3. Keep service-role-only functions inaccessible to `anon` and `authenticated` unless deliberate public behavior requires otherwise.
4. Apply the migration to the intended project.
5. Verify the resulting schema/function privileges.
6. Commit the exact migration that was applied.
7. Include application compatibility handling when deployment order could temporarily put old code against new schema or new code against old schema.

### AI BYOK / Vault

User AI provider keys are stored in Supabase Vault. `user_preferences.custom_ai_vault_secret_id` is an opaque reference, not the secret itself.

The Vault store/read/delete RPCs are intended for server-side service-role use only. Do not grant them to browser roles.

The historical `custom_ai_key` field exists only for compatibility/migration fallback and should not be used for new writes.

## GitHub target-repository writes

RepoFinisher repository writes are approval-bound and base-SHA-bound.

Expected sequence:

1. inspect current target HEAD;
2. prepare exact plan;
3. calculate/store plan hash;
4. obtain required approval or explicit bounded-autonomy acknowledgement;
5. re-check base SHA;
6. create isolated branch/commit;
7. create draft PR;
8. verify CI/runtime evidence;
9. repair only within bounded safety rules;
10. measure and persist outcome.

Automatic merge is not part of the default policy.

## Incident handling

When production is broken:

- identify whether the failure is frontend, API, Supabase/auth, AI provider, GitHub integration, or target-repository CI;
- inspect the actual deployed commit/SHA before changing source;
- preserve logs/evidence before redeploying;
- prefer a focused forward fix over reverting unrelated completed work;
- do not weaken security or validation merely to restore a green status;
- document meaningful root-cause findings in code/tests/docs or operational learning rather than relying on chat memory.

## Hosting migration rule

Do not restore Vercel as a workaround. If Netlify or Render has an operational problem, repair or deliberately replace that component with an approved architecture change. A temporary outage does not authorize reintroducing prohibited Vercel deployment configuration.

## Known migration debt

The API still contains a legacy `@vercel/functions` runtime helper import for `waitUntil` in some long-running paths. This is not an approved hosting dependency and should be replaced with a provider-neutral background-job mechanism. Until replaced, do not expand its use or interpret its presence as permission to deploy on Vercel.
