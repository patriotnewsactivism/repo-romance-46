# RepoFinisher Architecture

## Production topology

This is the authorized target. Deployment evidence and outstanding cutover requirements are tracked in `PROJECT_STATE.md`.

```text
Browser
  |
  v
Vercel
  React/Vite frontend
  portfolio.donmatthews.live
  |
  | Supabase JWT
  v
Contabo
  repofinisher-api
  api.portfolio.donmatthews.live (Caddy HTTPS proxy)
  |
  +------> Supabase Auth/Postgres/RLS/Vault
  |
  +------> GitHub API / GitHub Actions
  |
  +------> configured AI/research providers

Supabase durable completion sessions
  |
  v
Contabo
  repofinisher-worker
  persistent polling + lease/heartbeat claims
  |
  +------> GitHub branches / draft PRs / CI evidence
```

## Frontend

`artifacts/repo-finisher` is a React/Vite SPA deployed on Vercel.

The frontend:

- authenticates through Supabase;
- starts GitHub OAuth through Supabase;
- receives Supabase sessions;
- sends the Supabase bearer token to the Contabo API;
- never receives service-role, signing, encryption, or provider secrets.

## API/control plane

`artifacts/api-server` is a persistent Express service deployed on Contabo.

Responsibilities include:

- authenticated API operations;
- repository analysis;
- preferences/provider orchestration;
- trusted Supabase operations;
- exact-plan generation;
- repository-write control;
- durable session creation/status;
- CI/runtime evidence collection.

Health endpoint:

`GET /api/healthz`

## Persistent worker plane

`artifacts/api-server/src/persistent-worker.ts` is the Contabo worker entrypoint.

The worker polls active `repo_completion_sessions` from Supabase and passes each candidate through the existing `processCompletionSession` lease logic.

The existing worker contract protects against duplicate execution through:

- `worker_token`;
- `lease_expires_at`;
- heartbeat state;
- stale-base verification;
- persistent branch/PR/run state.

Production API configuration uses:

`REPOFINISHER_WORKER_MODE=persistent`

This tells the API to leave durable work queued for the persistent worker instead of depending on an in-process task.

## Authentication

Supabase Auth is the identity provider.

GitHub OAuth flow:

1. frontend calls `supabase.auth.signInWithOAuth({ provider: 'github' })`;
2. GitHub redirects to the Supabase Auth callback;
3. Supabase completes the OAuth exchange;
4. Supabase redirects to `/auth/callback` on the frontend;
5. the frontend persists the GitHub provider token to the trusted API path as designed.

GitHub Client ID/Secret are configured in Supabase Auth, not Vercel.

## Data and secrets

Supabase stores user/session/application state.

Contabo loads server-only runtime environment variables from a restricted `runtime.env` file; `deploy/contabo/compose.yml` starts the API, worker and Caddy.

Vercel stores browser-safe build/runtime variables.

Do not cross these trust boundaries.

## Apex ↔ Think Tank self-heal loop

A scheduled GitHub Actions workflow (`.github/workflows/apex-thinktank-sync.yml`, code in `scripts/src/apex-sync/`) is the only automation that writes to another repository. It reads Apex component health with a read-only token, debates a minimal patch with Think Tank, verifies it locally, and opens a draft PR in Apex. It does not touch the Vercel frontend, the Contabo API/worker, or Supabase state. Details and gates: [`APEX_THINKTANK_LOOP.md`](APEX_THINKTANK_LOOP.md).

## Legacy infrastructure

Railway, Cloud Run and Cloud Run Jobs are retired. Legacy files may remain temporarily for migration history or cleanup, but active code, CI, documentation, and operations must target Vercel/Contabo/Supabase.
