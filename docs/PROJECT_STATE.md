# RepoFinisher Project State

**Snapshot date:** 2026-10-25 (America/Chicago).

## Authorized production architecture

- Vercel: React/Vite frontend at `https://portfolio.donmatthews.live`.
- Contabo: persistent Express API at `https://api.portfolio.donmatthews.live`.
- Contabo: separate persistent completion worker with the existing Supabase lease/heartbeat contract.
- Supabase: Auth/Postgres/RLS/Vault/durable sessions.
- GitHub + GitHub Actions: source, draft PRs and CI.

The user explicitly shut down Railway and directed the API/worker to Contabo or Vercel. Contabo matches the existing persistent worker model. Railway and Cloud Run are retired; do not reconnect or deploy to them.

## Verified observations

- The Vercel frontend is serving the merged source including the earlier cache/cooldown fixes.
- Its retired API destination responds with platform-level HTTP 404 “Application not found”.
- The Supabase GitHub check still reports remote migration versions missing from the local migration directory.
- The current Supabase connector cannot inspect project `rdsrxfzahhxbvugyarld`; its data/schema state is unverified.

## Migration implementation

`deploy/contabo/compose.yml` defines Caddy, API and worker services using `Dockerfile.apiserver`. The worker entrypoint is `persistent-worker.ts`, and production queues sessions with `REPOFINISHER_WORKER_MODE=persistent`.

Frontend callers share the canonical API resolver. Retired build-variable destinations are rejected. Deployment, smoke checks and operating instructions target Vercel + Contabo + Supabase.

## Remaining release requirements

- Identify the intended Contabo server and establish approved SSH/network access.
- Provision the existing Supabase credentials and ORIGINAL signing/encryption keys securely on that server.
- Build and start the reviewed API/worker image; verify healthy containers and a real queue read.
- Point the API hostname at Contabo and verify Caddy TLS and CORS.
- Deploy the matching frontend on Vercel.
- Verify authenticated settings, repository analysis and a bounded worker cycle.
- Inspect/reconcile the existing Supabase migration-history discrepancy with access to the correct project.

The migration configuration being present or CI passing does not establish that the Contabo runtime is deployed. Record deployment and authenticated-flow evidence before declaring the cutover complete.
