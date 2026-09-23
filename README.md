# RepoFinisher

RepoFinisher is a repository-completion operating system. It inspects incomplete or partially working repositories, infers intended product behavior from evidence, measures completion and production readiness, creates approval-bound implementation plans, executes approved changes on isolated branches, validates the result, performs bounded repair, rescoring, and operational learning, and can continue iterating until explicit completion targets are reached or a safe stop condition applies.

## Canonical production architecture

RepoFinisher now uses a split production architecture:

- **Frontend:** `artifacts/repo-finisher` (React/Vite) on **Vercel**.
- **API/control plane:** `artifacts/api-server` (Express) on **Railway** as `repofinisher-api`.
- **Long-running completion worker:** the same API/worker codebase on **Railway** as `repofinisher-worker`, using the persistent `railway-worker.mjs` entrypoint.
- **Authentication and database:** **Supabase**.
- **Durable execution state and RLS:** **Supabase Postgres**.
- **User AI credentials:** **Supabase Vault** where supported by the trusted backend path.
- **Source control and CI:** **GitHub + GitHub Actions**.
- **Observability:** Sentry when configured, plus Vercel and Railway runtime/build logs.

Canonical frontend:

`https://portfolio.donmatthews.live`

Railway API service domain:

`https://repofinisher-api-production.up.railway.app`

Planned canonical API hostname:

`https://api.portfolio.donmatthews.live`

Cloud Run is retired infrastructure. Files and notes that reference it are migration history only and must not be treated as current production architecture.

## Runtime flow

1. The browser loads the Vite SPA from Vercel.
2. Supabase handles user authentication and GitHub OAuth.
3. The SPA calls the Railway API with the user's Supabase bearer token.
4. The Railway API reads/writes durable state in Supabase and performs trusted server-side operations.
5. Finish-until-target work is persisted as an active completion session in Supabase.
6. The Railway worker polls durable session state, claims work using the existing lease/heartbeat contract, executes bounded work, and releases the lease.
7. GitHub remains the source of truth for repository state, branches, draft PRs, CI evidence, and commit history.

## Core capabilities

RepoFinisher includes or is designed to include:

- full-portfolio repository discovery and prioritization;
- completion and production-readiness scoring;
- confidence-adjusted valuation and opportunity analysis;
- source-backed competitor/pricing/feature research;
- evidence-driven multi-stage reasoning;
- explicit plan approval and base-SHA binding;
- isolated branches and draft pull requests;
- CI/runtime verification;
- bounded self-healing repair;
- iterative finish-until-target sessions;
- operational learning based on measured outcomes;
- external coding-agent handoffs.

## Repository layout

```text
artifacts/
  api-server/             Express API + Railway worker entrypoints
  repo-finisher/          React/Vite frontend deployed on Vercel
  repo-finisher-mobile/   Mobile artifact
  mockup-sandbox/         Non-production sandbox
lib/                      Shared repository intelligence and API packages
supabase/migrations/      Forward-only database migrations
docs/                     Architecture, operations, state, policy, runbooks
.github/workflows/        CI and production verification
Dockerfile.apiserver      Railway API/worker image
vercel.json               Vercel frontend build/routing configuration
```

## Development

Requirements:

- Node.js 20+
- pnpm `9.15.9`
- Supabase configuration for authenticated/server-side features

Install and validate:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Run the frontend:

```bash
pnpm --filter @workspace/repo-finisher dev
```

Run the API:

```bash
pnpm --filter @workspace/api-server dev
```

## Environment and secrets

Use [`.env.example`](.env.example) as the canonical variable inventory.

Security rules:

1. `VITE_*` values are browser-visible. Never put service-role keys, provider secrets, GitHub tokens, signing secrets, encryption keys, or private keys in them.
2. Vercel frontend configuration requires the Supabase public URL/key and the API base URL or the source fallback.
3. Railway API and worker services require trusted Supabase credentials for server-side work.
4. `PLAN_SIGNING_SECRET` and `SECRET_ENCRYPTION_KEY` are backend-only.
5. GitHub OAuth Client ID/Secret belong in the Supabase GitHub auth provider configuration, not in browser-facing Vercel variables.
6. User AI BYOK credentials must remain behind the trusted backend/Vault boundary.

## CI and production release

A merge is not equivalent to a production release.

For production-impacting work verify separately:

- GitHub CI is green;
- the Vercel frontend deployment is healthy;
- the Railway API deployment is healthy;
- `/api/healthz` succeeds on the Railway API;
- the Railway worker is running without crash/restart loops;
- required Supabase migrations/configuration are present;
- canonical DNS points at the intended Vercel/Railway targets;
- authenticated user flows work end to end.

See [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md).

## Documentation

Start with [`docs/README.md`](docs/README.md).

Important files:

- [`AGENTS.md`](AGENTS.md)
- [`SECURITY.md`](SECURITY.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)
- [`docs/RAILWAY_MIGRATION.md`](docs/RAILWAY_MIGRATION.md)
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md)
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md)
- [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md)
- [`docs/DECISIONS.md`](docs/DECISIONS.md)

`docs/CLOUD_RUN_MIGRATION.md` is retained only as historical migration context.
