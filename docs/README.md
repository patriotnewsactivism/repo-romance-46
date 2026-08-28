# RepoFinisher Documentation Index

Canonical documentation lives here and at the repository root.

Start with:

- [`../README.md`](../README.md) — product/repository overview.
- [`../AGENTS.md`](../AGENTS.md) — mandatory operating contract for coding agents.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current deployment/status/priorities checkpoint.

Architecture, operations, and governance:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system components and control/data flows.
- [`OPERATIONS.md`](OPERATIONS.md) — production deployment, environment, rollback, and incident runbook.
- [`DECISIONS.md`](DECISIONS.md) — durable architecture/product decisions and their rationale.
- [`GOVERNANCE.md`](GOVERNANCE.md) — branch/PR/CI/hosting/database governance rules and current branch-protection gap.
- [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) — production release gates from branch through runtime verification/rollback.

AI/autonomy:

- [`REASONING_AND_LEARNING.md`](REASONING_AND_LEARNING.md) — reasoning pipeline, operational memory, prompt experiments, self-healing, and iterative completion target.
- [`AI_PROVIDERS.md`](AI_PROVIDERS.md) — provider/model settings, BYOK Vault storage, and provider acceptance checks.
- [`EXTERNAL_LLM_HANDOFFS.md`](EXTERNAL_LLM_HANDOFFS.md) — required structure and safety/validation contract for external coding-agent completion prompts.

Security/observability:

- [`../SECURITY.md`](../SECURITY.md) — repository security policy and secret handling.
- [`sentry-observability.md`](sentry-observability.md) — Sentry configuration and verification.

Historical compatibility notes:

- [`gemini-3-7-default.md`](gemini-3-7-default.md) — retained as a pointer because old links may exist; the original Vercel-era content is obsolete.
- [`gemini-configuration-status.md`](gemini-configuration-status.md) — current Gemini pointer to the provider-neutral docs.

Contribution workflow:

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)

## CI governance checkpoint

Issue #71 restored an explicit GitHub Actions pull-request verification trigger and added `workflow_dispatch` as an operator recovery path. PR #72 proved the restored CI path with tests, typecheck, build, and the non-Vercel hosting guard passing before merge. A stale external `Vercel` commit status may still appear until that third-party repository integration is disconnected; it is not an approved deployment target and must never be used to satisfy CI.

## Documentation rules

1. `AGENTS.md` is the canonical agent-policy file.
2. Model-specific root files (`CLAUDE.md`, `GEMINI.md`, `QWEN.md`, Copilot instructions) should remain thin pointers rather than fork policy.
3. `PROJECT_STATE.md` is time-sensitive; update it as infrastructure/features are verified.
4. Architecture/security/hosting changes must update the corresponding docs in the same PR.
5. External-agent prompt behavior must stay aligned with `EXTERNAL_LLM_HANDOFFS.md` and the internal completion contract.
6. Production-impacting work should use `RELEASE-CHECKLIST.md` rather than treating merge success as release completion.
7. If code and docs disagree, verify current code/production state and fix the discrepancy instead of choosing whichever text is more convenient.
8. Never place secret values in documentation.
