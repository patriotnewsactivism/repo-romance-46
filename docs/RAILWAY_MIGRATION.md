# Railway Migration and Cutover

**Started:** 2026-09-19

## Target

RepoFinisher is moving from the retired Cloud Run topology to:

- Vercel frontend;
- Railway persistent API;
- Railway persistent completion worker;
- Supabase auth/database/durable state;
- GitHub/GitHub Actions source and CI.

## Railway project

Project: `RepoFinisher`

Services:

- `repofinisher-api`
- `repofinisher-worker`

Both services track:

`patriotnewsactivism/repo-romance-46` → `main`

## API service

Dockerfile:

`Dockerfile.apiserver`

Health:

`GET /api/healthz`

Direct domain:

`https://repofinisher-api-production.up.railway.app`

Custom domain attached:

`api.portfolio.donmatthews.live`

Railway DNS target reported during setup:

`hbv52064.up.railway.app`

## Worker service

Dockerfile:

`Dockerfile.apiserver`

Start command:

`node artifacts/api-server/dist/railway-worker.mjs`

The worker does not require a public domain.

The worker polls active durable sessions in Supabase and uses the existing lease/heartbeat logic before performing work.

## Production worker mode

The API uses:

`REPOFINISHER_WORKER_MODE=railway-persistent`

When this mode is active the API leaves completion work in durable Supabase state and returns `railway-worker` as the scheduling mode. The persistent Railway worker discovers and claims the session.

## Required trusted values

Before authenticated and repository-write flows can be considered production-ready, configure the real existing production values on the Railway services:

- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `PLAN_SIGNING_SECRET`
- `SECRET_ENCRYPTION_KEY`

Do not invent or rotate signing/encryption material just to complete the migration.

Provider/research/Sentry credentials are added only for enabled features.

## Frontend cutover

The frontend source now uses Railway as its production fallback API and rejects the known retired Cloud Run API URL even if an old Vercel environment value still contains it.

Canonical frontend:

`https://portfolio.donmatthews.live`

The frontend hostname must resolve to Vercel.

## DNS

Required final mapping:

```text
portfolio.donmatthews.live      -> Vercel
api.portfolio.donmatthews.live  CNAME hbv52064.up.railway.app
```

Do not remove a working target until the replacement service has passed runtime checks.

## Acceptance

The migration is complete only when:

1. GitHub CI passes current `main`.
2. Vercel deploys the current frontend.
3. Railway API build succeeds.
4. Railway API health passes.
5. Railway worker build succeeds and remains running.
6. Trusted Supabase/signing/encryption variables are configured.
7. Frontend calls Railway API.
8. Supabase login works.
9. GitHub OAuth works.
10. One authenticated analysis succeeds.
11. One bounded completion session is claimed and advanced by the Railway worker.
12. Both canonical DNS names resolve to the intended providers with valid TLS.

## Legacy cleanup

After acceptance:

- keep Cloud Run migration documentation only for historical audit value;
- disable/remove automatic Cloud Run deployment workflows;
- remove Cloud Run-only scheduler code once no rollback dependency remains;
- remove Google-specific deployment scripts/config that are no longer required;
- remove retired domain-routing instructions.
