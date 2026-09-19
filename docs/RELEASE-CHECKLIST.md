# RepoFinisher Release Checklist

## Source and CI

- [ ] Intended commit/branch identified.
- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] Tests pass.
- [ ] Typecheck/build pass.
- [ ] Documentation consistency check passes.
- [ ] No secrets were committed.

## Supabase

- [ ] Required migrations are applied.
- [ ] RLS/policies/functions are verified.
- [ ] GitHub OAuth provider is enabled when auth changes depend on it.
- [ ] Redirect allow list includes the canonical frontend callback.
- [ ] Trusted service credentials are available to Railway.

## Vercel frontend

- [ ] Deployment builds from the intended commit.
- [ ] Root page loads.
- [ ] SPA routes work.
- [ ] Browser bundle uses Railway API, not a retired Cloud Run URL.
- [ ] Supabase public variables are present.
- [ ] Canonical frontend domain resolves to Vercel.

## Railway API

- [ ] `repofinisher-api` builds from the intended commit.
- [ ] Service remains running.
- [ ] Railway health check passes.
- [ ] `GET /api/healthz` returns success.
- [ ] CORS permits the intended Vercel origin.
- [ ] Trusted Supabase/signing/encryption variables are configured.
- [ ] Authenticated API request succeeds.

## Railway worker

- [ ] `repofinisher-worker` builds from the intended commit.
- [ ] Start command is `node artifacts/api-server/dist/railway-worker.mjs`.
- [ ] Service remains running without a restart loop.
- [ ] Trusted Supabase/signing/encryption variables are configured.
- [ ] Active durable session can be claimed.
- [ ] Lease/heartbeat state prevents duplicate work.
- [ ] Worker restart does not duplicate completed branch writes.

## Domains

- [ ] `portfolio.donmatthews.live` points to Vercel.
- [ ] `api.portfolio.donmatthews.live` points to Railway.
- [ ] TLS is valid on both.
- [ ] No canonical hostname still routes to retired Google infrastructure.

## User-flow verification

- [ ] Sign in succeeds.
- [ ] GitHub OAuth succeeds.
- [ ] GitHub connection persists.
- [ ] Repository list/analysis succeeds.
- [ ] Settings save/reload works.
- [ ] At least one bounded completion session progresses through the Railway worker when worker-affecting changes are released.

## Release state wording

Report these separately:

- merged;
- deployed;
- runtime verified;
- domain verified;
- authenticated user-flow verified.

Do not collapse them into a single “done” claim.
