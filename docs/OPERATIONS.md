# RepoFinisher Production Operations

## Production surfaces

- Frontend: Vercel project `repo-romance-46`, `https://portfolio.donmatthews.live`.
- API: Contabo, container `api`, `https://api.portfolio.donmatthews.live`, health `/api/healthz`.
- Worker: Contabo, container `worker`, `node artifacts/api-server/dist/persistent-worker.mjs`; no public port.
- Data/auth: Supabase project currently referenced by source, `rdsrxfzahhxbvugyarld`.

Deployment configuration is `deploy/contabo/compose.yml`. Caddy is the only public reverse proxy, terminates TLS and forwards to the private API. The API retains exactly one trusted proxy hop and the existing CORS allowlist and rate-limit budgets. Do not add a CDN/proxy in front without reviewing that trust boundary.

## Contabo deployment

Use [CONTABO_MIGRATION.md](CONTABO_MIGRATION.md) for the first cutover. The deployment script runs **on the intended Contabo server**, from a checkout of the reviewed commit:

```bash
bash deploy/contabo/deploy.sh
```

Create `deploy/contabo/compose.env` from its example first. It contains only the API domain, image tag and runtime-env file location. Create the server-only `runtime.env` from `runtime.env.example`, restrict it to mode 600 and populate credentials through the server's secure provisioning path. The script validates Compose without printing its expanded configuration, builds the image and waits for healthy API/worker containers.

Mandatory trusted variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
PLAN_SIGNING_SECRET
SECRET_ENCRYPTION_KEY
CORS_ALLOWED_ORIGINS
```

Preserve the original encryption/signing material. Replacing these values can invalidate stored provider credentials and approvals. Add only the backend AI/research/Sentry keys needed by enabled features. Never put these in `VITE_*`.

Compose sets `NODE_ENV=production`, `PORT=8080` and `REPOFINISHER_WORKER_MODE=persistent`. Operational worker controls are `REPOFINISHER_WORKER_CONCURRENCY=2` and `REPOFINISHER_WORKER_POLL_MS=3000`.

## Runtime verification

```bash
docker compose --env-file deploy/contabo/compose.env -f deploy/contabo/compose.yml ps
curl --fail http://127.0.0.1:8080/api/healthz
```

The API port is bound to server loopback only. Check the public HTTPS seam separately:

```bash
API_URL=https://api.portfolio.donmatthews.live FRONTEND_URL=https://portfolio.donmatthews.live CI_STRICT_SMOKE=1 node scripts/smoke-check.mjs
```

Verify an authenticated Settings save/reload and one bounded completion-session cycle using the user's normal session. API health alone does not validate Supabase access or stored credential decryption.

The worker publishes its health file only after successfully reading the Supabase queue. Its heartbeat stays fresh during long jobs and expires after polling failures. Inspect `persistent_worker_*` events and confirm no restart loop. Existing `worker_token`, `lease_expires_at` and heartbeat claims remain responsible for preventing duplicate repository writes.

## Vercel frontend

`vercel.json` builds `artifacts/repo-finisher/dist/public`. Production `VITE_API_BASE_URL` should be `https://api.portfolio.donmatthews.live`. The source ignores retired platform URLs left in old build variables; both generated API calls and direct valuation requests share this resolver.

Deploy the frontend after the Contabo API is healthy through the public domain. Verify root/SPA routes, browser API requests, Supabase auth, GitHub OAuth callback and Settings save/reload. Keep preview protection and existing secret boundaries intact.

## DNS and TLS

`portfolio.donmatthews.live` stays on Vercel. Replace the API hostname's retired CNAME with an A record pointing to the Contabo server; add AAAA only when working IPv6 is configured. Ports 80 and 443 must reach Caddy for automatic certificate issuance/renewal. Keep the database and worker private. Permit SSH only through the approved administration path.

## Supabase

The existing Supabase GitHub integration reports remote migration versions missing locally. Reconcile against the actual project's migration history before applying schema changes; do not invent migration entries or reset production data. The current connector also needs access to the intended project before this can be inspected.

Keep the existing Supabase project and data during the hosting move. GitHub OAuth stays in Supabase Authentication: Site URL is the Vercel frontend and the redirect allowlist must include `https://portfolio.donmatthews.live/auth/callback`.

## Rollback

Use the previous reviewed image tag and matching runtime configuration on Contabo, then rerun the health and worker checks. Frontend rollback uses a compatible Vercel deployment that still targets the canonical API. Prefer forward database recovery. Railway and Cloud Run are retired and are not rollback targets.
