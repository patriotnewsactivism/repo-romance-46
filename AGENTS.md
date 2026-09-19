# RepoFinisher Agent Operating Contract

This file defines the operating rules for coding agents and external LLMs working in this repository.

Read this file, `README.md`, and `docs/PROJECT_STATE.md` before architecture or deployment work.

## Mission

RepoFinisher must become exceptionally good at taking incomplete, abandoned, partially functioning, poorly deployed, or poorly designed repositories and turning them into finished, tested, secure, deployable, commercially useful applications.

Do not reduce the product to a recommendation dashboard or one-shot code generator.

## Canonical production architecture

Current production architecture:

- **Vercel** — React/Vite frontend from `artifacts/repo-finisher`.
- **Railway** — persistent Express API service `repofinisher-api`.
- **Railway** — persistent background worker service `repofinisher-worker`.
- **Supabase** — Auth, Postgres, RLS, durable execution state, Vault-backed trusted data paths.
- **GitHub + GitHub Actions** — source control, branches, draft PRs, CI/build/test evidence.
- **Sentry** — optional application observability.

Canonical frontend: `https://portfolio.donmatthews.live`.

Cloud Run is retired. Do not reintroduce Cloud Run as an active deployment target merely because legacy files remain in the repository.

## Security boundaries

Never commit secrets.

Never place these in frontend code or `VITE_*` variables:

- Supabase secret/service-role keys;
- GitHub access tokens;
- AI provider API keys;
- `PLAN_SIGNING_SECRET`;
- `SECRET_ENCRYPTION_KEY`;
- Sentry auth tokens;
- private keys or credential JSON.

GitHub OAuth Client ID/Secret are configured in Supabase Auth's GitHub provider. The browser receives only normal OAuth/session results.

User-supplied AI provider credentials must remain behind the trusted server/Vault boundary.

Do not weaken RLS, auth checks, CORS, rate limits, approval gates, branch isolation, secret handling, or least-privilege controls for convenience.

## Repository-write contract

Normal generated repository work must:

1. resolve the exact repository and base SHA;
2. gather current evidence;
3. identify blockers/root causes;
4. produce an exact bounded plan;
5. bind the plan to the base commit/hash;
6. obtain the required approval;
7. re-check stale-base state;
8. write to an isolated branch;
9. open a draft PR;
10. validate CI/runtime evidence;
11. perform only bounded evidence-driven repair;
12. re-score completion/readiness and persist outcome telemetry.

Automatic merge is not authorized by default.

## Railway worker contract

Finish-until-target work is durable state in Supabase, not an HTTP request lifetime.

The Railway worker:

- polls active `repo_completion_sessions`;
- claims work through the existing `worker_token` / `lease_expires_at` / heartbeat contract;
- executes only work it successfully claims;
- preserves branch/PR state across retries;
- releases leases when a processing cycle ends;
- must tolerate restart without duplicating completed branch writes.

The API service should use `REPOFINISHER_WORKER_MODE=railway-persistent` in production so requests queue durable work for the persistent worker instead of relying on in-process background execution.

Local development may use the in-process fallback.

## Completion discipline

Do not declare a repository finished merely because CI is green.

Completion should consider, as applicable:

- core user journeys;
- frontend UX/responsiveness;
- API correctness;
- auth/authorization;
- schema/migrations;
- deployment configuration;
- production runtime health;
- accessibility;
- security controls;
- automated tests;
- error handling/observability;
- documentation/operator setup.

Use `docs/DEFINITION_OF_DONE.md`.

## Deployment discipline

For frontend changes, verify the Vercel deployment and canonical domain.

For backend changes, verify Railway build/runtime state and `/api/healthz`.

For worker changes, verify the Railway worker process remains alive and can safely claim durable work.

Do not infer runtime success from a merge.

## Documentation discipline

Canonical documents:

- `README.md`
- `AGENTS.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/PROJECT_STATE.md`
- `docs/RAILWAY_MIGRATION.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/RELEASE-CHECKLIST.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/DECISIONS.md`

`docs/CLOUD_RUN_MIGRATION.md` is historical only.

When code/workflows and documentation conflict, inspect current deployment evidence and correct both in the same change.
