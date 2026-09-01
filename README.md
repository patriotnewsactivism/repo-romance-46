# RepoFinisher

RepoFinisher is a repository-completion operating system. It inspects incomplete or partially working software repositories, infers product intent from evidence, measures completion and production readiness, reasons about the highest-value remaining work, produces approval-bound implementation plans, executes approved changes on isolated branches, validates the result, performs bounded repair, rescoring, and operational learning, and can continue iterating until explicit completion targets are reached or a safe stop condition applies.

RepoFinisher is not a one-shot code generator. Its design centers on current evidence, explicit write authority, durable state, measurable outcomes, rollback boundaries, and repeatable verification.

## Canonical production architecture

The current production architecture in `main` is:

- **Frontend:** `artifacts/repo-finisher` deployed as Google Cloud Run service `repofinisher-web`.
- **API / control plane:** `artifacts/api-server` deployed as Google Cloud Run service `repofinisher-api`.
- **Long-running completion work:** Google Cloud Run Job `repofinisher-completion-session`.
- **Authentication, database, RLS, durable execution state, and AI BYOK Vault:** Supabase.
- **Source control, pull requests, repository evidence, CI/build/test evidence, and deployment automation:** GitHub + GitHub Actions.
- **Container registry and backend secret injection:** Google Artifact Registry + Google Secret Manager.
- **Canonical custom-domain DNS:** Cloudflare, managed by the Cloud Run deployment workflow during cutover.
- **Observability:** Sentry when configured, plus Cloud Run/Cloud Logging.

The canonical product domain is `https://portfolio.donmatthews.live`.

**Vercel is not an approved deployment target. Do not deploy RepoFinisher to Vercel or reintroduce Vercel hosting artifacts.** The CI workflow contains an explicit non-Vercel hosting guard.

`netlify.toml` and the former Render service are legacy migration/rollback artifacts, not the current target topology. Do not route production back to them unless an explicit incident rollback decision is made and verified.

For time-sensitive rollout status, read [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md). For the Cloud Run deployment/cutover contract, read [`docs/CLOUD_RUN_MIGRATION.md`](docs/CLOUD_RUN_MIGRATION.md).

## Core capabilities

RepoFinisher includes or is designed to include:

- full-portfolio repository discovery and prioritization;
- explicit full-portfolio scope through 1,000 paginated accessible repositories, independent of the selected AI model;
- completion and production-readiness scoring;
- confidence-adjusted current/potential valuation estimates;
- investor-facing PDF export built from current portfolio evidence and adjusted valuation;
- duplicate/shared-IP and portfolio relationship analysis;
- tiered deep analysis for large portfolios;
- source-backed live competitor/pricing/feature research when a trusted research provider is configured, with explicit unavailable states instead of invented market facts;
- feature opportunity analysis with desirability, incremental value planning ranges, revenue scenarios, assumptions, acceptance checks, risks, and source evidence;
- documentation-only reconciliation for README, `AGENTS.md`, plans/roadmaps, and `docs/*.md`, guarded against runtime-code changes;
- multi-stage reasoning with evidence analysis, competing hypotheses, skeptical critique, evidence-selected specialists, and principal-plan synthesis;
- durable repo-local and cross-repo operational memory based on measured outcomes;
- controlled prompt-strategy experiments whose mutable strategy cannot alter immutable safety/approval policy;
- exact-plan/base-SHA hashing and approval binding before repository writes;
- isolated branches and draft pull requests;
- CI and deployment/runtime verification;
- bounded self-healing CI repair based on fresh failure evidence and root-cause diagnosis;
- finish-until-target sessions that can reason, implement, verify, repair, rescore, and iterate;
- continuous repository event reasoning;
- security/product assurance checks;
- external-LLM completion handoffs for Codex, Claude Code, Gemini CLI, or a provider-neutral coding agent.

External-LLM handoffs complement RepoFinisher; they do not replace its internal finishing capability.

## Investor, market, and growth workflows

The Full Portfolio Value surface includes a plain-language capability guide and an **Export investor PDF** action. Recommendation cards expose **Research market & growth**, source-backed competitor snapshots, feature/value opportunities, plan-first feature implementation, documentation reconciliation, and the iterative **Finish until target** controller.

Market accuracy is deliberately asymmetric: RepoFinisher may generate clearly labeled planning scenarios from repository evidence, but it may show a named competitor's customer pricing, features, positioning, or URL only when live external source evidence supports those claims. Without a configured live-research credential, external competitor/pricing research is shown as unavailable rather than guessed.

See [`docs/INVESTOR_AND_GROWTH_TOOLS.md`](docs/INVESTOR_AND_GROWTH_TOOLS.md) for the evidence rules, implementation flow, documentation-only guard, PDF contents, and finish-until-target defaults.

## Repository layout

```text
artifacts/
  api-server/             Express control plane + Cloud Run Job entrypoints
  repo-finisher/          Production React/Vite frontend
  repo-finisher-mobile/   Mobile artifact; excluded from root production build
  mockup-sandbox/         Non-production sandbox artifact
infra/gcp/                Google Cloud bootstrap/IAM/WIF tooling
lib/                      Shared workspace libraries and repo intelligence
scripts/                  Smoke checks, documentation guards, tooling
supabase/migrations/      Forward-only production database migrations
docs/                     Architecture, operations, state, policy, runbooks
.github/workflows/        CI, Cloud Run deploy, production smoke
Dockerfile.apiserver      API/worker image
Dockerfile.frontend       Frontend image
Dockerfile                Root frontend compatibility entrypoint for Cloud Build repository triggers
netlify.toml               Legacy frontend-host configuration; not canonical production
```

## Development

Requirements:

- Node.js 20+ for local/CI compatibility.
- pnpm `9.15.9`.
- Supabase configuration for authenticated/server-side features.

Install:

```bash
pnpm install --frozen-lockfile
```

Run tests:

```bash
pnpm test
```

Run typechecks and production builds:

```bash
pnpm build
```

Run frontend locally:

```bash
pnpm --filter @workspace/repo-finisher dev
```

Run API locally:

```bash
pnpm --filter @workspace/api-server dev
```

Run production-seam smoke logic:

```bash
pnpm test:smoke
```

## Environment and secrets

Use [`.env.example`](.env.example) as the canonical variable inventory.

Security rules:

1. `VITE_*` variables are browser-visible. Never put service-role keys, AI provider secrets, GitHub tokens, signing secrets, Sentry auth tokens, private keys, or encryption keys in them.
2. Browser configuration requires `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.
3. Trusted backend features require Supabase public config plus a trusted backend key (`SUPABASE_SECRET_KEY` preferred), `PLAN_SIGNING_SECRET`, and `SECRET_ENCRYPTION_KEY` where applicable.
4. User-supplied AI provider credentials are stored in **Supabase Vault** and are only decrypted through the trusted backend path.
5. `SECRET_ENCRYPTION_KEY` still protects server-sealed credentials such as stored GitHub connections; rotating it without a migration can make prior envelopes unreadable.
6. GitHub Actions authenticates to Google Cloud using Workload Identity Federation. Do not add a long-lived Google service-account JSON key.
7. Cloud Run receives backend secrets from Google Secret Manager. Do not embed them in workflow YAML or container images.
8. `TAVILY_API_KEY`, when used for live market research, is backend-only. Never expose it through `VITE_*`; when it is absent, competitor/pricing research must fail closed to an explicit unavailable state.

See [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md), [`SECURITY.md`](SECURITY.md), and [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Autonomous repository-write contract

Normal generated repository work must preserve these boundaries:

1. Resolve the exact repository and base SHA.
2. Gather current evidence and operational learning.
3. Produce an exact bounded implementation plan.
4. Bind the plan to the base commit with a plan hash/signature.
5. Require exact-plan approval unless the user explicitly selected a product-defined bounded higher-autonomy mode.
6. Re-check stale-base state before writing.
7. Write to an isolated branch.
8. Open a draft PR.
9. Verify CI and applicable deployment/runtime evidence.
10. Perform only bounded, evidence-driven repair.
11. Re-score completion/readiness and persist outcome telemetry.
12. Continue another bounded iteration only when policy, budget, risk, and no-progress rules permit it.

Automatic merge is not the default policy.

Passing CI alone is not proof that a target repository is finished. The default evidence threshold is defined in [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md).

## Learning model

RepoFinisher's "learning" is measured operational learning, not silent model-weight retraining.

The system can persist outcome score, completion/readiness deltas, failure modes, repair diagnoses, prompt strategy/version, specialists, evidence confidence, deployment/CI outcomes, and cross-repository patterns. A failed strategy should become less likely to be repeated unchanged; a successful strategy should only become reusable guidance when supported by measurable evidence.

Prompt experimentation may change planning/reasoning technique, but it cannot alter immutable security, approval, permission, rollback, or validation policy.

See [`docs/REASONING_AND_LEARNING.md`](docs/REASONING_AND_LEARNING.md).

## External coding-agent handoffs

For each repository, RepoFinisher can produce a separate detailed completion prompt for an external coding agent. A handoff should include the assessed SHA, current completion/readiness state, evidence-backed blockers, ordered work, specialist concerns, validation requirements, security boundaries, and the same Definition of Done used internally. If the repository HEAD changed after assessment, the external agent must re-assess before editing.

See [`docs/EXTERNAL_LLM_HANDOFFS.md`](docs/EXTERNAL_LLM_HANDOFFS.md).

## Database migrations

All production schema changes belong in `supabase/migrations/`.

Migrations should be forward-only, deterministic, safe for existing data, explicit about destructive behavior, RLS-aware, and least-privilege. Service-role-only Vault functions must never be granted to normal browser roles.

Do not call a migration-dependent feature production-ready until the migration has been applied and the expected schema/policies/functions have been verified.

## CI and production release

`.github/workflows/ci.yml` is the required code gate. It verifies the non-Vercel hosting policy, frozen-lockfile install, tests, documentation consistency, typecheck, and build.

`.github/workflows/deploy-cloud-run.yml` builds immutable API/worker and frontend images, deploys the completion-session Job, API service, and frontend service, audits the runtime environment contract, manages the custom-domain mapping/DNS cutover, and verifies the deployed surfaces.

`.github/workflows/production-smoke.yml` verifies the production seams.

A commit being merged is not equivalent to a production release. Use [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) and report `merged`, `deployed`, `runtime verified`, and `user-flow verified` precisely.

## Documentation map

Start with [`docs/README.md`](docs/README.md). Key files:

- [`AGENTS.md`](AGENTS.md) — canonical coding-agent operating rules.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — branch/PR/contribution workflow.
- [`SECURITY.md`](SECURITY.md) — security and secret handling.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stable system design.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — production runbook.
- [`docs/CLOUD_RUN_MIGRATION.md`](docs/CLOUD_RUN_MIGRATION.md) — Cloud Run deployment/cutover contract and rollback history.
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — time-sensitive status and remaining work.
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — completion evidence standard.
- [`docs/REASONING_AND_LEARNING.md`](docs/REASONING_AND_LEARNING.md) — reasoning, memory, experiments, repair, iterative sessions.
- [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md) — provider/model/BYOK behavior.
- [`docs/INVESTOR_AND_GROWTH_TOOLS.md`](docs/INVESTOR_AND_GROWTH_TOOLS.md) — investor PDF export, live market evidence, feature scenarios, safe feature planning, docs-only reconciliation, and finish-until-target UI.
- [`docs/EXTERNAL_LLM_HANDOFFS.md`](docs/EXTERNAL_LLM_HANDOFFS.md) — external-agent handoff contract.
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — release gates.
- [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) — incident response.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable architecture/product decisions.
- [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) — repository governance.

## Source of truth

When sources disagree, use this order:

1. Current code/migrations/workflows on `main`.
2. `AGENTS.md` for agent operating rules.
3. `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/OPERATIONS.md` for stable architecture/policy.
4. `docs/PROJECT_STATE.md` for time-sensitive rollout state.
5. `docs/DEFINITION_OF_DONE.md` for completion claims.
6. Model-specific instruction files only as pointers to `AGENTS.md`.

When code and documentation disagree, do not choose whichever text is convenient. Verify the implementation and update the documentation in the same PR.
