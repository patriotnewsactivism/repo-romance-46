# RepoFinisher Architecture Decisions

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
