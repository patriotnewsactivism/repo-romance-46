# Contributing to RepoFinisher

## Production targets

Current production targets are:

- Vercel — frontend;
- Railway `repofinisher-api` — API/control plane;
- Railway `repofinisher-worker` — persistent completion worker;
- Supabase — auth/database/durable state;
- GitHub Actions — CI.

Cloud Run is legacy migration history, not a current deployment target.

## Development workflow

Use focused branches and pull requests.

Before requesting review:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Do not bypass failing CI.

## Production-impacting changes

A production change is not complete until the affected runtime is verified.

Frontend changes require:

- Vercel deployment success;
- SPA route verification;
- canonical-domain verification when DNS/routing changed.

API changes require:

- Railway deployment success;
- `/api/healthz` success;
- CORS verification;
- relevant authenticated flow verification.

Worker changes require:

- Railway worker deployment success;
- no crash loop;
- durable session polling/lease behavior verified.

Database changes require forward-only migrations in `supabase/migrations/` and verification of RLS/policies/functions.

## Secrets

Do not commit secrets.

Never put service-role keys, GitHub tokens, provider keys, signing secrets, or encryption keys in `VITE_*`.

## Documentation

Architecture, deployment, environment, and security changes must update the canonical documentation in the same change.
