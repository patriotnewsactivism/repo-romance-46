# RepoFinisher — Replit context

This repository is no longer governed by the old generated Replit template that previously occupied this file.

Canonical documentation:

1. [`AGENTS.md`](AGENTS.md) — coding-agent operating contract.
2. [`README.md`](README.md) — product and repository overview.
3. [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — current operational checkpoint and open priorities.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture.
5. [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — production/deployment runbook.
6. [`SECURITY.md`](SECURITY.md) — security and secret handling.

Current production architecture is Netlify frontend + Render persistent API + Supabase auth/database/Vault + GitHub source/CI. Vercel is not an approved deployment target.

Use pnpm. Before merging code, obtain green repository CI (`pnpm test` and `pnpm build` are the core local equivalents).

Do not maintain a second Replit-only architecture or policy in this file. Update the canonical docs instead.