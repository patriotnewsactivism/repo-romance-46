# RepoFinisher Project State

**Snapshot date:** 2026-09-19

This file is intentionally time-sensitive.

## Current target architecture

- Vercel — frontend.
- Railway `repofinisher-api` — persistent API/control plane.
- Railway `repofinisher-worker` — persistent completion worker.
- Supabase — Auth/Postgres/RLS/Vault/durable state.
- GitHub + GitHub Actions — source and CI.

Canonical frontend:

`https://portfolio.donmatthews.live`

Railway direct API:

`https://repofinisher-api-production.up.railway.app`

Canonical API hostname being configured:

`https://api.portfolio.donmatthews.live`

## Changes made during the 2026-09-19 cutover

- Created Railway project `RepoFinisher`.
- Created Railway service `repofinisher-api`.
- Created Railway service `repofinisher-worker`.
- Connected both services to `patriotnewsactivism/repo-romance-46` on `main`.
- Configured API builds to use `Dockerfile.apiserver`.
- Configured Railway health check `/api/healthz`.
- Added persistent Railway worker entrypoint.
- Added `REPOFINISHER_WORKER_MODE=railway-persistent` support.
- Updated frontend fallback API away from the retired Cloud Run endpoint to the Railway API service domain.
- Attached `api.portfolio.donmatthews.live` to the Railway API service.
- Railway reported the API custom-domain DNS target as `hbv52064.up.railway.app`.

## DNS state requiring completion

As observed during this migration, `portfolio.donmatthews.live` was still returning a Google Frontend 503 before DNS was corrected. The frontend hostname must point to Vercel.

For the API custom hostname Railway requires:

```text
api.portfolio.donmatthews.live  CNAME  hbv52064.up.railway.app
```

DNS provider changes are external to the current Railway/Vercel connectors and must be verified separately.

## Required secrets still to verify on Railway

The API and worker need the real production trusted values for the RepoFinisher Supabase project and repository-write security:

- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `PLAN_SIGNING_SECRET`
- `SECRET_ENCRYPTION_KEY`

AI/research/Sentry keys are required only for the corresponding enabled features.

Do not fabricate or rotate these values during migration. In particular, changing the encryption/signing material without a migration can invalidate stored credentials or in-flight approvals.

## Current validation status

The architecture/source migration is in progress. Do not call the cutover complete until all of the following are verified:

- Railway API build succeeds;
- Railway API process is healthy;
- `/api/healthz` succeeds;
- Railway worker stays running with trusted secrets configured;
- Vercel frontend deployment succeeds from the current `main`;
- frontend calls the Railway API;
- Supabase auth and GitHub OAuth complete end to end;
- canonical frontend DNS points to Vercel;
- API DNS points to Railway;
- one authenticated repository analysis succeeds;
- one bounded completion-session worker cycle succeeds.

Cloud Run is retired and should not be restored as the canonical target.
