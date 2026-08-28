# Contributing to RepoFinisher

RepoFinisher is a production system that can reason about and modify other repositories. Changes should therefore be small enough to audit, backed by evidence, and validated before merge.

## Before you start

Read:

- `README.md`
- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `SECURITY.md`

For reasoning/agent changes also read `docs/REASONING_AND_LEARNING.md`.

## Branches and pull requests

Use a focused branch from current `main`.

Prefer one coherent change per PR. A bug fix should not quietly become a broad architecture rewrite unless the root cause genuinely requires it.

PR descriptions should state:

- the problem being fixed;
- root cause or evidence;
- files/components affected;
- migrations/config changes;
- validation performed;
- security/approval implications; and
- known limitations or follow-up work.

## Required validation

RepoFinisher uses pnpm.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

GitHub Actions CI must pass before merge.

For production-impacting changes, verify the deployed path and run the production smoke workflow when applicable.

## Database changes

Add forward migrations under `supabase/migrations/`.

Do not modify migration files already applied to production.

Document:

- new tables/columns/functions;
- RLS/grants;
- deployment ordering concerns; and
- migration verification performed.

## Environment/config changes

Update `.env.example` and relevant docs in the same PR.

Never commit real secrets.

Private server credentials must not use a `VITE_` prefix.

## Reasoning/learning changes

A change to prompt strategy, specialists, memory, scoring, repair or agent orchestration should include tests for the behavior that can be tested deterministically.

Preserve the distinction between:

- immutable safety/authorization policy; and
- mutable reasoning strategy.

Do not improve benchmark outcomes by weakening verification or acceptance criteria.

## UI changes

Check both mobile and desktop behavior. Dark-theme contrast, navigation visibility and accessible interaction states are production requirements, not cosmetic extras.

## Hosting

Supported production hosting is Netlify for the frontend and Render for the persistent API.

Do not introduce Vercel deployment configuration.

## Documentation

Update docs whenever the change affects architecture, hosting, secrets, provider support, migrations, autonomy, reasoning semantics, CI or operations.

Delete superseded documentation rather than leaving multiple conflicting sources of truth.
