# Repository Governance

This document defines repository-level controls that keep RepoFinisher changes reviewable and production-safe.

## Main branch

`main` is the canonical source branch.

At the start of this documentation pass, GitHub reported `main` as **not protected** and required status-check enforcement as off. That is a governance gap.

Recommended repository rule/branch-protection policy:

- require pull requests before merge,
- require the `CI / verify` workflow (or its current equivalent) to pass,
- require branches to be up to date when appropriate,
- block force pushes to `main`,
- block deletion of `main`,
- preserve administrator bypass only when there is a documented emergency need,
- do not enable automatic merge as a workaround for autonomous workflow convenience.

Do not describe branch protection as enabled until GitHub settings actually confirm it.

## Pull requests

Production-impacting changes should normally land through focused PRs.

PR descriptions should state:

- verified problem/root cause,
- implementation,
- tests/CI evidence,
- migration impact,
- deployment impact,
- security/autonomy impact,
- known remaining work.

## CI

The repository CI gate currently covers:

- non-Vercel hosting policy,
- frozen pnpm install,
- package tests,
- typecheck,
- production builds.

Do not bypass or weaken CI to merge a feature.

If a CI check is flaky, fix the flake or isolate the failure with evidence. Do not remove the check because it is inconvenient.

## Autonomous code changes

RepoFinisher-generated work in target repositories is expected to use isolated branches and draft PRs.

The RepoFinisher repository itself should follow the same discipline when autonomous agents modify its source: focused branch, CI, reviewed diff, merge after verification.

## Merge authority

Automatic merge is not a default RepoFinisher policy.

Any future change that enables unattended merging must be treated as a distinct security/autonomy decision and must specify:

- exact scope,
- repository allowlist,
- required checks,
- branch protection interactions,
- rollback behavior,
- risk/cost limits,
- audit trail,
- explicit user authorization model.

## Secrets and access

Do not place credentials in repository settings/configuration files when a platform secret store is available.

Access should follow least privilege:

- frontend uses publishable Supabase credentials only,
- backend owns service-role/Vault access,
- GitHub tokens are scoped to required repository operations,
- AI provider BYOK secrets are Vault-backed,
- Sentry auth token is build/operator-only.

## Hosting governance

Approved production hosting is Netlify + Render + Supabase + GitHub.

Vercel is explicitly prohibited as a RepoFinisher production deployment target.

A hosting-provider change is an architecture decision, not an incidental deployment tweak. It must update `docs/DECISIONS.md`, `AGENTS.md`, `README.md`, operations docs, CI guards, environment documentation, and production smoke checks.

## Database governance

Production schema changes require migration files in `supabase/migrations/`.

Do not make undocumented dashboard-only schema changes that cannot be reconstructed from the repository.

When an emergency manual migration is unavoidable, immediately add the exact equivalent migration file and verify the repository history matches production state.

## Documentation governance

Canonical policy should not live only in chat history.

When a material decision is made:

- put durable policy in `AGENTS.md`/`docs/DECISIONS.md`,
- put current status/blockers in `docs/PROJECT_STATE.md`,
- update environment/operations docs when deployment behavior changes.

Model-specific instructions must defer to `AGENTS.md`.

## Production verification

A merged commit is not the same as a verified release.

For production-impacting work, record which of these were actually completed:

- CI passed,
- migration applied,
- Render deployed,
- Netlify deployed,
- production smoke passed,
- authenticated user flow verified.

If a layer is unverified, say so.