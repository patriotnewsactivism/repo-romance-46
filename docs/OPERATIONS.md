# RepoFinisher Production Operations

## Production surfaces

Frontend:

- platform: Vercel
- project: `repo-romance-46`
- canonical hostname: `portfolio.donmatthews.live`

API:

- platform: Railway
- service: `repofinisher-api`
- direct hostname: `repofinisher-api-production.up.railway.app`
- canonical API hostname: `api.portfolio.donmatthews.live` after DNS verification
- health: `/api/healthz`

Worker:

- platform: Railway
- service: `repofinisher-worker`
- command: `node artifacts/api-server/dist/railway-worker.mjs`
- public domain: none required

Data/auth:

- platform: Supabase
- project ref used by current source: `rdsrxfzahhxbvugyarld`

## Vercel frontend deployment

The frontend build is controlled by `vercel.json`.

Production output:

`artifacts/repo-finisher/dist/public`

Verify after deployment:

- root page loads;
- SPA routes resolve;
- browser bundle points to Railway API, not a retired `.run.app` API;
- Supabase auth loads;
- GitHub OAuth returns to `/auth/callback`.

## Railway API deployment

The API uses `Dockerfile.apiserver`.

Required operational checks:

1. build succeeds;
2. process remains running;
3. Railway health check on `/api/healthz` passes;
4. CORS allows the canonical Vercel frontend;
5. authenticated API calls reach Supabase successfully.

Production API variables include:

```text
NODE_ENV=production
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
PLAN_SIGNING_SECRET
SECRET_ENCRYPTION_KEY
CORS_ALLOWED_ORIGINS
REPOFINISHER_WORKER_MODE=railway-persistent
```

Provider/research/Sentry keys are added only when those features are enabled.

## Railway worker deployment

The worker uses the same Docker image with an overridden start command:

```text
node artifacts/api-server/dist/railway-worker.mjs
```

Required worker variables include the trusted Supabase credentials and repository-write security secrets required by the work it performs.

Operational variables:

```text
RAILWAY_WORKER_CONCURRENCY=2
RAILWAY_WORKER_POLL_MS=3000
```

Verify:

- process remains alive;
- no repeated crash/restart loop;
- active sessions are discovered;
- leases prevent duplicate execution;
- branch/PR state remains resumable across worker restart.

## DNS

Frontend:

`portfolio.donmatthews.live` must resolve to Vercel.

API:

`api.portfolio.donmatthews.live` is attached to Railway. Railway currently requires its DNS record to point to the target returned by Railway domain configuration.

Do not leave either hostname pointing to retired Google infrastructure.

## Supabase GitHub OAuth

In GitHub OAuth App settings, the authorization callback URL is the Supabase Auth callback for the RepoFinisher Supabase project.

In Supabase:

- enable GitHub provider;
- enter GitHub Client ID;
- enter GitHub Client Secret;
- set Site URL to the canonical frontend;
- allow `https://portfolio.donmatthews.live/auth/callback`.

## Rollback

Frontend rollback: use a known-good Vercel deployment.

API/worker rollback: use a known-good Railway deployment.

Database rollback should normally use forward recovery rather than destructive reversal unless a migration explicitly supports safe rollback.

Cloud Run is not the production rollback target.
