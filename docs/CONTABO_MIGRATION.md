# Contabo API and worker migration

The authorized topology is Vercel frontend + Contabo API/worker + Supabase data/auth. Railway is shut down. Its old service address and Cloud Run endpoints must not be used as deployment, fallback or rollback destinations.

## Why Contabo

The current API performs background analysis and the worker polls durable completion sessions, renewing leases while awaiting AI/GitHub/CI work. A persistent Contabo host preserves this model. Moving it wholesale into request-lifetime Vercel functions would require a separate durable-job redesign.

## Local verification

After building `Dockerfile.apiserver` as `repofinisher:contabo-check`, run `python3 deploy/contabo/check-runtime.py`. It uses isolated disposable containers, random loopback ports and a fake Supabase queue to check authentication/CORS, Caddy forwarding, non-root/read-only execution, worker readiness/failure/recovery and graceful shutdown. It uses no production credentials and cleans up only its own containers/network.

## Server prerequisites

Use the existing intended Contabo server with a supported Linux release, Docker Engine and Docker Compose v2. Review existing workloads and port usage before installing or replacing anything. This stack binds public ports 80/443 for Caddy and server loopback 8080 for the API; adapt deliberately if another reverse proxy already owns those ports.

Obtain the server hostname/IP and SSH username through the normal administration path. Configure SSH credentials and any required network grants through the managed environment. Never paste private keys, passwords, provider credentials or service-role keys in chat, commits or logs.

## Prepare the release

Check out the reviewed source commit on the server. Use a release-specific `REPOFINISHER_IMAGE` tag in `deploy/contabo/compose.env` so the prior image can be retained for rollback.

```bash
cp deploy/contabo/compose.env.example deploy/contabo/compose.env
cp deploy/contabo/runtime.env.example deploy/contabo/runtime.env
chmod 600 deploy/contabo/runtime.env
```

Populate `runtime.env` through the server's secure provisioning path with the original Supabase URL, public and trusted server credentials, `PLAN_SIGNING_SECRET`, `SECRET_ENCRYPTION_KEY`, and the exact allowed frontend origins. Optional backend provider/research credentials use the names in `.env.example`. For stronger separation, keep the file outside the checkout and set `REPOFINISHER_ENV_FILE` to its absolute path in `compose.env`.

Do not generate replacement encryption/signing keys or switch Supabase projects to make a health check pass: existing encrypted provider keys, approvals and session records depend on the original configuration. Supabase migration-history reconciliation is a separate data operation and must be verified against the intended project's actual history.

Build and start:

```bash
bash deploy/contabo/deploy.sh
```

The script does not install host software or change DNS. It validates configuration without printing secrets, builds the image and waits for health. API/worker run as the image's non-root `node` user, with a read-only root filesystem, temporary writable `/tmp`, dropped capabilities and bounded logs. The API binds to loopback on the host; the worker exposes no port.

## API hostname and HTTPS

Replace the retired API CNAME with an A record for `api.portfolio.donmatthews.live` pointing at the verified Contabo address. Add AAAA only for configured, reachable IPv6. The frontend hostname stays on Vercel.

Caddy obtains and renews HTTPS certificates for `API_DOMAIN`. Its data/config volumes preserve certificate state. It is the only trusted proxy hop: Express retains `trust proxy = 1`, the existing IPv6 grouping and unchanged rate limits. Caddy's default forwarding behavior prevents caller-supplied forwarded addresses from replacing the directly observed client address. Do not add upstream proxies without reviewing that topology.

## Verify before frontend cutover

1. Compose reports API and worker healthy. Worker readiness requires a successful Supabase queue read, not just a running PID.
2. Server loopback and public HTTPS `/api/healthz` return HTTP 200 JSON.
3. The protected AI-status route returns JSON 401 without a session; CORS exposes retry headers only to allowed origins.
4. An authenticated Settings save/reload works with the original encrypted credential data.
5. A bounded completion session is claimed and progresses without duplicate branch writes. Lease/heartbeat protection is unchanged.

Run the committed smoke script against the public seam as documented in `OPERATIONS.md`. Inspect container logs without dumping environment files or printing expanded Compose configuration.

Once the API is healthy through its domain, deploy the matching frontend on Vercel with `VITE_API_BASE_URL=https://api.portfolio.donmatthews.live`. Both standard API requests and direct valuation calls use the shared resolver; stale retired-host build variables cannot override it. Verify browser requests and OAuth callbacks on the canonical frontend.

## Recovery

Keep the previous reviewed image tag and matching runtime configuration. Roll back the image on Contabo and recheck queue/lease behavior and the public API before pairing it with a compatible Vercel frontend. Do not reset the database or return traffic to retired providers.
