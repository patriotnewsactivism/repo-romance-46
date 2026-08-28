# Contributing to RepoFinisher

RepoFinisher is a production-oriented autonomous repository-completion system. Changes should improve verified completion quality without weakening security, approval, or rollback boundaries.

Before contributing, read:

- `README.md`
- `AGENTS.md`
- `SECURITY.md`
- `docs/PROJECT_STATE.md`

For architecture or deployment changes also read `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md`.

## Branches and pull requests

Use a focused branch for each coherent change.

Good examples:

```text
fix/settings-ai-provider-save
feat/iterative-completion-controller
docs/repo-operating-manual
```

Avoid bundling unrelated refactors into a production-critical fix.

Open a pull request against `main` and describe:

- the verified problem,
- root cause,
- implementation,
- migration/deployment impact,
- tests/evidence,
- risks/remaining gaps.

Do not hide known incomplete work in optimistic PR language.

## Required local/CI checks

Use pnpm only.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The root build includes typechecking and workspace production builds.

GitHub CI is authoritative for merge readiness. Do not bypass a red pipeline.

## Production hosting

Approved production targets are:

- Netlify frontend
- Render API
- Supabase data/auth/Vault
- GitHub source/CI

Vercel must not be used or reintroduced as a deployment target.

## Database changes

Put all schema changes in `supabase/migrations/`.

A migration PR should explain:

- tables/columns/functions changed,
- RLS/policy impact,
- grant/revoke impact,
- data migration behavior,
- destructive/irreversible operations,
- required application deployment ordering.

Use least privilege. Service-role-only Vault operations must remain unavailable to browser roles.

## Secrets

Never commit secrets or embed them in frontend variables.

Do not include secrets in PR descriptions, issues, test fixtures, screenshots, or logs.

If a secret is accidentally exposed, rotate it immediately; do not rely on deleting it from the latest commit alone.

## AI/provider changes

Supported provider/model behavior should remain explicit and testable.

When adding a provider:

1. add provider normalization/status,
2. add model handling,
3. use secure BYOK storage,
4. ensure the key is never returned to the frontend,
5. add provider-specific request mapping,
6. add tests,
7. update Settings UX and documentation,
8. verify production persistence and an actual invocation path.

Do not add provider names to the UI before the backend can really use them.

## Reasoning/learning changes

Changes to reasoning must preserve the distinction between:

- immutable safety/approval policy,
- mutable planning/reasoning strategy.

When changing learning logic, prefer measured outcomes over subjective prompt changes. Add tests for regression, minimum evidence, and failure cases.

## Autonomous write changes

Any change that increases write authority or autonomy requires explicit review of:

- approval behavior,
- stale-base behavior,
- branch/PR rollback boundaries,
- path/content safety,
- secret handling,
- repair limits,
- merge policy,
- cost/time/risk budgets.

Do not silently turn a recommendation feature into autonomous writes.

## UI changes

Verify both mobile and desktop.

For header/theme changes, specifically verify readable contrast, mobile menu behavior, opaque menu backgrounds, and dark/light states.

For Settings changes, verify save/reload/error states and cross-origin API calls from the production frontend architecture.

## Documentation changes

When architecture, environment variables, hosting, security storage, migration requirements, or operational behavior changes, update the canonical docs in the same PR.

Model-specific instruction files should remain thin pointers to `AGENTS.md`; do not fork the repository rules into competing documents.

## Definition of done

A code change is not done merely because it was written.

Depending on scope, done may require:

- tests green,
- build/typecheck green,
- migration applied,
- Render deployment healthy,
- Netlify deployment healthy,
- production smoke green,
- authenticated user flow verified,
- outcome telemetry observed,
- documentation updated.

Record what was actually verified.