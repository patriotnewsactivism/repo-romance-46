# RepoFinisher Documentation Index

Canonical documentation lives here and at the repository root.

Start with:

- [`../README.md`](../README.md) — product/repository overview.
- [`../AGENTS.md`](../AGENTS.md) — mandatory operating contract for coding agents.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current deployment/status/priorities checkpoint.
- [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) — evidence standard for declaring a target repository materially complete.

Architecture, operations, and governance:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system components and control/data flows.
- [`OPERATIONS.md`](OPERATIONS.md) — production deployment, environment, rollback, and operating procedures.
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — pre-merge, migration, deployment, smoke, and post-release checklist.
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — incident triage, hosting/provider/autonomy diagnosis, rollback, and closure criteria.
- [`DECISIONS.md`](DECISIONS.md) — durable architecture/product decisions and their rationale.
- [`GOVERNANCE.md`](GOVERNANCE.md) — branch/PR/CI/hosting/database governance rules and current branch-protection gap.

AI/autonomy:

- [`REASONING_AND_LEARNING.md`](REASONING_AND_LEARNING.md) — reasoning pipeline, operational memory, prompt experiments, self-healing, and iterative completion target.
- [`AI_PROVIDERS.md`](AI_PROVIDERS.md) — provider/model settings, BYOK Vault storage, and provider acceptance checks.
- [`EXTERNAL_LLM_HANDOFF.md`](EXTERNAL_LLM_HANDOFF.md) — required contents and safety/evidence contract for external completion prompts.

Security/observability:

- [`../SECURITY.md`](../SECURITY.md) — repository security policy and secret handling.
- [`sentry-observability.md`](sentry-observability.md) — Sentry configuration and verification.

Historical compatibility notes:

- [`gemini-3-7-default.md`](gemini-3-7-default.md) — retained as a pointer because old links may exist; the original Vercel-era content is obsolete.
- [`gemini-configuration-status.md`](gemini-configuration-status.md) — current Gemini pointer to the provider-neutral docs.

Contribution workflow:

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- [PR template](../.github/pull_request_template.md) — requires verification/security/deployment disclosure.
- [Bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml) — structured, secret-safe defect reporting.
- [Feature request template](../.github/ISSUE_TEMPLATE/feature_request.yml) — requires evidence and acceptance criteria.

## Documentation rules

1. `AGENTS.md` is the canonical agent-policy file.
2. Model-specific root files (`CLAUDE.md`, `GEMINI.md`, `QWEN.md`, Copilot instructions) should remain thin pointers rather than fork policy.
3. `PROJECT_STATE.md` is time-sensitive; update it as infrastructure/features are verified.
4. `DEFINITION_OF_DONE.md` is the default product-completion evidence standard; product-specific acceptance criteria may add to it but should not silently weaken it.
5. Architecture/security/hosting changes must update the corresponding docs in the same PR.
6. Release claims should distinguish code merged, migration applied, deployed, runtime verified, and authenticated-user-flow verified.
7. If code and docs disagree, verify current code/production state and fix the discrepancy instead of choosing whichever text is more convenient.
8. Never place secret values in documentation.