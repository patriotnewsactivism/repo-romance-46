# RepoFinisher Architecture Decisions

## D003 — Apex ↔ Think Tank self-heal loop runs in GitHub Actions and opens draft PRs only

**Status:** accepted 2026-10-19.

The loop (Apex health → Finisher plan → Think Tank debate → local test gate → Apex PR) runs as a scheduled GitHub Actions job in this repository, not from an assistant chat schedule (1-hour floor, prompt-only, no event bus) and not as a Railway worker (it needs no durable queue; the ledger plus open-PR check make each tick idempotent).

- Correctness is decided only by running the regression test locally: it must fail on the base commit and pass with the patch, and the Apex package typecheck must pass. Think Tank output is advisory; consensus is never proof.
- The loop may only push `fix/apex-*` branches and open **draft** PRs. It never merges, never pushes to `main`, and never triggers a deploy. This keeps the AGENTS.md repository-write contract intact; Vercel, Railway and Supabase deployment verification stays with the normal release process.
- It is dry-run unless the repository variable `APEX_SYNC_LIVE` is `true`.

See [`APEX_THINKTANK_LOOP.md`](APEX_THINKTANK_LOOP.md).

## D002 — Split production runtime: Vercel + Railway + Supabase + GitHub

**Status:** accepted — 2026-09-19

RepoFinisher uses:

- Vercel for the React/Vite frontend;
- Railway for the persistent Express API;
- Railway for persistent long-running completion workers;
- Supabase for authentication, database, RLS, durable state, and Vault-backed trusted data;
- GitHub/GitHub Actions for source, branches, PRs, and CI.

### Rationale

The frontend benefits from Vercel's static/CDN deployment model.

The API and completion engine require persistent server processes and long-running/background execution. Railway maps directly to the existing Express + worker model without forcing the completion engine into request-lifetime serverless functions.

Supabase already owns identity and durable execution state, so it remains the system of record.

### Worker decision

Production completion sessions are queued in Supabase and consumed by the Railway worker through the existing lease/heartbeat contract.

The API uses `REPOFINISHER_WORKER_MODE=railway-persistent`.

### Domain decision

- frontend: `portfolio.donmatthews.live` → Vercel;
- API: `api.portfolio.donmatthews.live` → Railway.

## D001 — Google Cloud Run production runtime

**Status:** superseded by D002 on 2026-09-19.

Cloud Run deployment material is retained only for migration/audit history until cleanup is complete. It must not be treated as current production architecture.
