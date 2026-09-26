# RepoFinisher Documentation Index

Canonical production topology is **Vercel frontend + Railway API/worker + Supabase auth/data + GitHub source/CI**.

Start with:

- [`../README.md`](../README.md) — product overview and current production topology.
- [`../AGENTS.md`](../AGENTS.md) — coding-agent operating contract.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — time-sensitive rollout state.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — stable system design.
- [`OPERATIONS.md`](OPERATIONS.md) — production runbook.
- [`RAILWAY_MIGRATION.md`](RAILWAY_MIGRATION.md) — current Cloud Run → Railway migration/cutover.
- [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) — completion evidence standard.
- [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) — production release gates.
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — incident handling.
- [`DECISIONS.md`](DECISIONS.md) — durable architecture decisions.
- [`../SECURITY.md`](../SECURITY.md) — secrets, auth, write boundaries.

Historical only:

- [`CLOUD_RUN_MIGRATION.md`](CLOUD_RUN_MIGRATION.md) — retired Cloud Run migration history.

## Documentation rules

1. Vercel is the canonical frontend host.
2. Railway is the canonical persistent API and worker host.
3. Supabase remains auth/database/durable-state infrastructure.
4. Cloud Run must not be described as active production infrastructure.
5. `PROJECT_STATE.md` is time-sensitive and must be updated after runtime verification.
6. A merge is not proof of a successful deployment.
7. Production-impacting changes update documentation and validation evidence together.
