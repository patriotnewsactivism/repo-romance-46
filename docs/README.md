# RepoFinisher Documentation Index

Canonical documentation lives here and at the repository root.

Current production source topology is Google Cloud Run frontend + API + completion-session Job, backed by Supabase and GitHub, with Cloudflare handling the canonical custom-domain DNS. `docs/PROJECT_STATE.md` records the time-sensitive rollout state and must be checked before infrastructure work.

Start with:

- [`../README.md`](../README.md) — product/repository overview and canonical runtime topology.
- [`../AGENTS.md`](../AGENTS.md) — mandatory operating contract for coding agents.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current deployment/status/priorities checkpoint.
- [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) — evidence standard for calling RepoFinisher or a target repository complete.

Architecture, operations, and governance:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system components and control/data flows.
- [`OPERATIONS.md`](OPERATIONS.md) — Cloud Run/Secret Manager/Cloudflare production runbook.
- [`CLOUD_RUN_MIGRATION.md`](CLOUD_RUN_MIGRATION.md) — Cloud Run deployment/cutover contract, current migration history, acceptance, and rollback.
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — severity, Cloud Run/domain/provider/autonomy diagnosis, rollback, and closure criteria.
- [`DECISIONS.md`](DECISIONS.md) — durable architecture/product decisions and rationale.
- [`GOVERNANCE.md`](GOVERNANCE.md) — branch/PR/CI/hosting/database governance rules.
- [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) — production release gates through Cloud Run/direct runtime/domain/user-flow verification.
- [`.github/pull_request_template.md`](../.github/pull_request_template.md) — per-PR evidence and safety checklist.

AI/autonomy:

- [`REASONING_AND_LEARNING.md`](REASONING_AND_LEARNING.md) — reasoning pipeline, operational memory, prompt experiments, self-healing, and iterative completion.
- [`AI_PROVIDERS.md`](AI_PROVIDERS.md) — provider/model settings, BYOK Vault storage, and provider acceptance checks.
- [`EXTERNAL_LLM_HANDOFFS.md`](EXTERNAL_LLM_HANDOFFS.md) — structure/safety/validation contract for external coding-agent completion prompts.

Security/observability:

- [`../SECURITY.md`](../SECURITY.md) — repository security policy, Google Cloud identity/secrets, Vault, and write boundaries.
- [`sentry-observability.md`](sentry-observability.md) — Sentry configuration and verification.

Historical compatibility notes:

- [`gemini-3-7-default.md`](gemini-3-7-default.md) — compatibility pointer for old links; provider behavior is governed by `AI_PROVIDERS.md`.
- [`gemini-configuration-status.md`](gemini-configuration-status.md) — Gemini pointer to provider-neutral configuration docs.

Contribution workflow:

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- [Bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml) — defect intake with secret-safety confirmation.
- [Feature request template](../.github/ISSUE_TEMPLATE/feature_request.yml) — evidence, acceptance criteria, architecture/safety constraints.

## Documentation rules

1. `AGENTS.md` is the canonical agent-policy file.
2. Model-specific root files (`CLAUDE.md`, `GEMINI.md`, `QWEN.md`, Copilot instructions) remain thin pointers rather than fork policy.
3. `PROJECT_STATE.md` is time-sensitive; update it as infrastructure/features are actually verified.
4. `DEFINITION_OF_DONE.md` defines the evidence threshold for completion claims; do not lower it to make scores look better.
5. Architecture/security/hosting changes update the corresponding docs in the same PR.
6. Production-impacting work uses `RELEASE-CHECKLIST.md`; merge success is not release completion.
7. External-agent prompt behavior stays aligned with `EXTERNAL_LLM_HANDOFFS.md` and the internal completion contract.
8. Production incidents use `INCIDENT_RESPONSE.md`, preserving evidence and separating code-fixed, deployed, direct-runtime-verified, canonical-domain-verified, and user-flow-verified states.
9. Public issues/docs never contain credentials or private secret material.
10. If code/workflows and docs disagree, inspect current `main` and actual deployment evidence, then fix the discrepancy rather than choosing whichever text is convenient.
11. Do not describe the production frontend as Netlify or the production API as Render unless documenting an explicit historical/rollback context. Canonical production is Cloud Run `repofinisher-web`, `repofinisher-api`, and `repofinisher-completion-session`.
12. Vercel is not an approved deployment target and must not be reintroduced in canonical architecture docs.
13. `scripts/check-docs-consistency.mjs` is a CI guard for obvious canonical-topology drift; keep it updated when a durable architecture decision changes.