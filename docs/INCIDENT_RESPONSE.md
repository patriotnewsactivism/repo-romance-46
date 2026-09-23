# RepoFinisher Incident Response

## Severity

Treat incidents involving credential exposure, unauthorized repository writes, corrupted approval state, or cross-user data access as security incidents.

Treat production frontend/API/worker outages as availability incidents.

## Frontend diagnosis — Vercel

Check:

- current deployment commit;
- deployment/build status;
- static asset/SPA routing;
- browser console/network errors;
- Supabase public variables;
- API base URL;
- canonical DNS.

If the browser is calling a `.run.app` RepoFinisher API, the deployment is stale or misconfigured.

## API diagnosis — Railway

Check:

- `repofinisher-api` latest deployment;
- build/runtime logs;
- `/api/healthz`;
- process restarts;
- required environment variable names;
- Supabase connectivity;
- CORS origin;
- upstream provider errors.

Use the Railway service domain to separate API health from custom DNS issues.

## Worker diagnosis — Railway

Check:

- `repofinisher-worker` latest deployment;
- start command;
- crash/restart loop;
- Supabase trusted key availability;
- worker polling errors;
- active session rows;
- `worker_token`, `lease_expires_at`, heartbeat state;
- GitHub/CI/provider failures for the affected session.

Do not manually clear leases until current worker/runtime evidence shows the lease is stale.

## Auth diagnosis — Supabase/GitHub

Check:

- Supabase GitHub provider enabled;
- correct Client ID/Secret;
- GitHub authorization callback URL points to Supabase Auth callback;
- Supabase Site URL;
- redirect allow list contains the frontend `/auth/callback`;
- provider token is returned/persisted as expected.

## DNS incidents

Frontend hostname must resolve to Vercel.

API hostname must resolve to Railway.

If either still resolves to Google Frontend/Cloud Run infrastructure, correct DNS before debugging application code at that hostname.

## Safe rollback

- Frontend: roll back to a known-good Vercel deployment.
- API/worker: roll back to known-good Railway deployments.
- Database: prefer forward recovery unless a migration has an explicit safe reversal.

Cloud Run is not the canonical emergency rollback target.

## Closure

Do not close an incident until the affected runtime and relevant user flow have both been verified.
