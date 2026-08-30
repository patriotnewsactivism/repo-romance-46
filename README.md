# RepoFinisher

RepoFinisher is a repository-completion operating system. Its job is to inspect incomplete or partially working software repositories, determine what the product is intended to do, measure how complete and production-ready it is, reason about the highest-value remaining work, generate an approval-bound implementation plan, execute approved changes on isolated branches, validate the result, repair bounded failures, and learn from measured outcomes.

RepoFinisher is not intended to be a one-shot code generator. The product is designed around evidence, explicit approval boundaries, repeatable verification, durable operational memory, and iterative improvement.

## Production architecture

The approved production architecture is:

- **Frontend:** React/Vite SPA on **Netlify**.
- **API / control plane:** Express API on **Google Cloud Run**.
- **Long-running completion work:** **Google Cloud Run Jobs**, dispatched from the API with durable Supabase session state and per-execution session/user overrides.
- **Repository CI/build/test evidence:** **GitHub Actions** and GitHub checks.
- **Database, authentication, RLS, and Vault:** **Supabase**.
- **Source control, pull requests, checks, and repository evidence:** **GitHub**.
- **Observability:** Sentry when configured, plus Cloud Run/Cloud Logging runtime logs.

**Vercel is not an approved deployment target for this repository. Do not deploy RepoFinisher to Vercel or reintroduce Vercel hosting artifacts.** CI enforces a subset of this policy.

During the Render-to-Cloud-Run cutover, the existing Render API is retained strictly as a rollback target until the Cloud Run service has passed direct-host health checks, the Netlify frontend has been rebuilt against the Cloud Run API URL, and production seam smoke passes. See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) and [`docs/CLOUD_RUN_MIGRATION.md`](docs/CLOUD_RUN_MIGRATION.md) before changing production DNS or environment variables.

The intended canonical frontend domain is `https://repofinisher.donmatthews.live`.

## What RepoFinisher does

Core capabilities include:

- Full-portfolio repository discovery and scoring.
- Completion and production-readiness scoring.
- Current and potential value estimates with confidence adjustment and overlap/duplicate-IP discounts.
- Tiered repository intelligence for large portfolios.
- Multi-stage reasoning: evidence analysis, skeptical critique, dynamically selected specialists, and principal-plan synthesis.
- Durable repo-level and cross-repo operational memory based on measured outcomes.
- Controlled prompt-strategy experiments. Strategy changes may improve planning technique but cannot weaken safety or approval policy.
- Exact-plan hashing and approval binding before repository writes.
- Isolated branches and draft pull requests for generated work.
- CI and deployment-preview verification.
- Bounded self-healing CI repair that diagnoses root causes and does not weaken validation to obtain a passing result, including direct completion and Finish Portfolio execution paths.
- Finish-until-target completion sessions that can reason, implement, verify, repair, rescore, and iterate toward explicit completion/readiness targets.
- Continuous Repository Mode for re-reasoning after repository events.
- Portfolio relationship analysis for duplicate/shared IP, frontend/backend pairs, workers, merge candidates, and archive candidates.
- Product/security assurance checks.
- External-LLM completion handoffs: a detailed current-state prompt for Codex, Claude Code, Gemini CLI, or a provider-neutral agent. This complements RepoFinisher's own autonomous completion path; it does not replace it.

## Repository layout

```text
artifacts/
  api-server/             Express API/control plane plus Cloud Run Job entrypoints
  repo-finisher/          Production React/Vite frontend
  repo-finisher-mobile/   Mobile artifact; excluded from the root production build
  mockup-sandbox/         Non-production sandbox artifact
infra/gcp/                 One-time Google Cloud/WIF bootstrap tooling
lib/                       Shared workspace libraries, including repo intelligence
scripts/                   Smoke checks and repository tooling
supabase/migrations/       Forward-only database migrations
docs/                      Architecture, operations, project state, and subsystem docs
.github/workflows/         CI, Cloud Run deployment, and production smoke workflows
netlify.toml               Netlify frontend build configuration
Dockerfile.apiserver       Cloud Run API/worker container
```

## Development

Requirements:

- Node.js 20+ for local/CI compatibility. Netlify currently declares Node 24 for its frontend build.
- pnpm `9.15.9`.
- A Supabase project when exercising authenticated/server features.

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Run the complete test suite:

```bash
pnpm test
```

Run typechecks and production builds:

```bash
pnpm build
```

Run the frontend locally:

```bash
pnpm --filter @workspace/repo-finisher dev
```

Run the API locally:

```bash
pnpm --filter @workspace/api-server dev
```

Run the seam smoke test:

```bash
pnpm test:smoke
```

## Environment configuration

Use [`.env.example`](.env.example) as the canonical variable inventory.

Important rules:

1. `VITE_*` values are browser-visible. Never put service-role keys, AI provider secrets, GitHub tokens, signing secrets, or encryption keys in a `VITE_*` variable.
2. The frontend needs `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.
3. The API needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, a trusted Supabase backend key (`SUPABASE_SECRET_KEY` preferred), `PLAN_SIGNING_SECRET`, and `SECRET_ENCRYPTION_KEY` for the features that depend on them.
4. User-supplied AI provider keys are stored through **Supabase Vault**. The browser never receives the decrypted credential.
5. `SECRET_ENCRYPTION_KEY` remains relevant to legacy/server-sealed credentials such as stored GitHub connections. It is not the primary storage mechanism for new AI BYOK credentials.
6. In production, `CLOUD_RUN_JOBS_ENABLED=true` makes the API dispatch finish-until-target sessions to the named Cloud Run Job instead of depending on request-lifetime background CPU.
7. Google Cloud authentication from GitHub Actions uses Workload Identity Federation. Do not add a long-lived service-account JSON key to GitHub secrets.

See [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md) for provider/model behavior and [`docs/CLOUD_RUN_MIGRATION.md`](docs/CLOUD_RUN_MIGRATION.md) for deployment setup.

## Autonomous completion contract

Repository-writing behavior must preserve these boundaries:

- The exact plan and base commit are bound to an approval hash before execution, unless the user has explicitly selected an already-defined bounded higher-autonomy mode.
- Generated work goes to an isolated branch and draft PR.
- Automatic merge is disabled unless product policy is deliberately changed and separately reviewed.
- Self-healing may fix source/configuration defects but may not weaken, delete, skip, mute, or rewrite tests/security/CI acceptance criteria merely to turn a failure green.
- Secrets may not be requested for inclusion in repository content or written into generated source.
- If the repository changes after planning, the plan is stale and must be regenerated.
- Passing CI alone is not proof that a repository is fully finished. Completion/readiness must be re-measured and unresolved product blockers must remain visible.
- Cloud Run worker retries must reuse durable session/lease state; they may not duplicate branch writes simply because an execution is retried.

The evidence threshold for calling a target repository materially complete is defined in [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md). Internal finishing and external-LLM handoffs must use the same substantive completion standard.

See [`AGENTS.md`](AGENTS.md) for the rules that automated coding agents must follow.

## Learning model

"Learning" in RepoFinisher means measured operational learning, not silent model-weight retraining.

The system records outcomes such as completion delta, production-readiness delta, outcome score, failures, repair evidence, prompt strategy, selected specialists, and supporting evidence. High-confidence patterns become reusable operational guidance. Failed patterns reduce confidence and should not be repeated unchanged.

Controlled prompt experiments can promote a challenger strategy only after measured evidence clears configured sample, practical-lift, and regression gates. The immutable safety/approval policy is outside the experiment surface.

See [`docs/REASONING_AND_LEARNING.md`](docs/REASONING_AND_LEARNING.md).

## External coding-agent handoffs

RepoFinisher can generate a current-state completion prompt for an external coding agent without giving up its own autonomous finishing capability. The handoff is bound to the assessed repository state and should carry the same evidence, remaining-work order, security boundaries, validation requirements, and Definition of Done used internally.

See [`docs/EXTERNAL_LLM_HANDOFFS.md`](docs/EXTERNAL_LLM_HANDOFFS.md).

## Database migrations

All schema changes belong in `supabase/migrations/` and should be forward-only, reviewable, and safe for production data.

For every migration:

- Preserve RLS where user-owned data is involved.
- Add only the minimum grants required.
- Never grant service-role-only Vault functions to `anon` or `authenticated`.
- Avoid generated-ID assumptions in migration data changes.
- Document destructive or irreversible behavior.
- Apply and verify the migration before claiming a dependent feature is production-ready.

## CI and release gates

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` and currently requires:

- no forbidden Vercel hosting artifacts,
- frozen-lockfile install,
- package tests,
- typecheck,
- production build.

`.github/workflows/deploy-cloud-run.yml` builds an immutable container image, deploys the completion-session Cloud Run Job, grants the runtime identity permission to invoke that specific job with overrides, deploys the API service, and verifies `/api/healthz`. It authenticates through GitHub OIDC/Google Workload Identity Federation rather than a service-account key.

`.github/workflows/production-smoke.yml` verifies the production seams among Netlify, the selected persistent API endpoint, and Supabase when manually dispatched.

Do not merge a feature merely because local code looks correct. A normal release should have green CI, a successful target-host deployment, and relevant runtime smoke evidence. Use [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) for production-impacting work and [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) when production is degraded or unsafe.

## Documentation map

- [`docs/README.md`](docs/README.md) — documentation index.
- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI/coding agents.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution and PR workflow.
- [`SECURITY.md`](SECURITY.md) — security and secret-handling requirements.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture and data/control flow.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deployment, environment, smoke, incident, and rollback procedures.
- [`docs/CLOUD_RUN_MIGRATION.md`](docs/CLOUD_RUN_MIGRATION.md) — Google Cloud Run/Jobs bootstrap, deployment, cutover, and rollback plan.
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — current operational checkpoint and known remaining work.
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — evidence standard for declaring a target repository materially complete.
- [`docs/REASONING_AND_LEARNING.md`](docs/REASONING_AND_LEARNING.md) — reasoning, memory, experiments, and self-healing behavior.
- [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md) — provider/model/BYOK behavior.
- [`docs/EXTERNAL_LLM_HANDOFFS.md`](docs/EXTERNAL_LLM_HANDOFFS.md) — external coding-agent completion handoff contract.
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — production release and verification gates.
- [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) — production incident triage, containment, recovery, and closure.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable architecture/product decisions.
- [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) — repository governance and control gaps.
- [`docs/sentry-observability.md`](docs/sentry-observability.md) — Sentry-specific notes.

## Source of truth

The hierarchy for decisions is:

1. Current code and migrations on `main`.
2. `AGENTS.md` for repository-working rules.
3. `README.md`, `docs/DECISIONS.md`, and the architecture/operations documentation.
4. `docs/PROJECT_STATE.md` for time-sensitive operational status.
5. `docs/DEFINITION_OF_DONE.md` for completion claims.
6. Model-specific instruction files are compatibility entrypoints only and must defer to `AGENTS.md`.
7. Old experiment notes, backup metadata, and archived branches are historical only unless explicitly promoted back into the canonical docs.

When code and documentation disagree, do not guess. Verify the implementation, fix the discrepancy, and update the documentation in the same PR.
