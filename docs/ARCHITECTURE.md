# RepoFinisher Architecture

This document describes the stable production architecture and major control/data flows. Use `docs/PROJECT_STATE.md` for time-sensitive deployment status.

## Runtime topology

RepoFinisher is a pnpm/TypeScript monorepo with these primary runtime concerns:

1. **Frontend SPA** — `artifacts/repo-finisher`
2. **API/control plane** — `artifacts/api-server`
3. **Long-running completion workers** — Cloud Run Jobs using the API-server worker entrypoint
4. **Shared repository-intelligence logic** — `lib/`
5. **Persistent state/security boundary** — Supabase schema and Vault

Canonical production topology:

```text
Browser
  |
  v
Cloudflare DNS -> repofinisher.donmatthews.live
  |
  v
Google Cloud Run: repofinisher-web
  |
  | HTTPS + Supabase bearer token
  v
Google Cloud Run: repofinisher-api
  |                    \
  |                     \-> Cloud Run Job: repofinisher-completion-session
  |                              |
  |                              +-> GitHub REST / Actions / PRs / checks
  |                              +-> configured AI provider
  |
  +-> Supabase: Auth / RLS / DB / Vault / durable execution state
  +-> GitHub: repository evidence and writes

GitHub Actions
  +-> CI/build/test
  +-> Workload Identity Federation -> Google Cloud deploy
  +-> Artifact Registry image publication
  +-> Cloud Run service/job deploy
  +-> custom-domain/DNS verification
```

**Vercel is not an approved production target.** Former Netlify/Render assets are legacy rollback/migration artifacts, not the canonical runtime.

## Frontend

The production web app lives in `artifacts/repo-finisher` and is built into a container with `Dockerfile.frontend`, then deployed as Cloud Run service `repofinisher-web`.

Responsibilities include:

- Supabase user authentication/session handling;
- portfolio/repository analysis UI;
- Settings and AI provider/model management;
- exact-plan approval UX;
- per-repository finishing controls;
- Finish Portfolio orchestration;
- finish-until-target session controls/status;
- external-LLM prompt generation/copy UX;
- learning/audit/assurance visibility where surfaced.

The frontend communicates with the API through `VITE_API_BASE_URL`. Production builds must point at the verified `repofinisher-api` Cloud Run endpoint. The frontend also communicates directly with Supabase for user-scoped auth/data paths; RLS remains the authorization boundary for those browser operations.

Critical UI reliability requirements include readable theme contrast, working mobile navigation, explicit Settings save/error states, and no accidental fallback of API calls to the static frontend host.

## API / control plane

The API lives in `artifacts/api-server` and is an Express application built to `dist/index.mjs`, deployed as Cloud Run service `repofinisher-api`.

The API owns trusted control-plane operations including:

- request authentication/authorization;
- GitHub credential use;
- repository inspection and metadata access;
- multi-agent reasoning/orchestration;
- exact-plan creation/signing;
- repository-write authorization;
- isolated branch/commit/draft-PR orchestration;
- portfolio completion orchestration;
- post-run re-scoring;
- operational-learning persistence;
- Supabase Vault AI credential access through trusted backend privilege;
- service-role-only operations;
- dispatch of long-running completion sessions to Cloud Run Jobs.

The API is intentionally not the permanent home for heavy or long-lived work. Tasks that may outlive an HTTP request should move to the worker plane while authoritative state remains durable in Supabase.

## Cloud Run worker plane

Finish-until-target sessions execute through the `completion-session-job` entrypoint using the same immutable API/worker image.

Target Job:

```text
repofinisher-completion-session
```

The API dispatches the Cloud Run Jobs v2 API with the attached runtime service-account identity. Per execution it passes only minimal identifiers such as:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

Repository state, approval state, progress, GitHub credentials, AI credentials, CI state, repair history, and stop conditions are loaded from durable trusted storage rather than serialized into job overrides.

The worker reuses completion-session lease/heartbeat guards. Scheduler/worker retries must not duplicate branch writes or re-run completed iterations merely because an execution retried.

The worker can progress a durable session through:

```text
reason
  -> implement
  -> verify
  -> bounded repair when justified
  -> rescore completion/readiness
  -> still below target and safe to continue?
  -> next bounded iteration
```

If a task execution reaches its budget/time limit while the session remains active, it should yield without fabricating success; the durable session can be dispatched again.

## Google Cloud deployment and identity

`.github/workflows/deploy-cloud-run.yml` is the production deployment workflow.

It builds immutable SHA-tagged frontend/API images, pushes them to Artifact Registry, deploys the completion-session Job, API service, and frontend service, audits environment-variable presence, verifies direct surfaces, and handles custom-domain/DNS cutover steps.

GitHub Actions authenticates to Google Cloud with GitHub OIDC + Workload Identity Federation. A long-lived Google service-account JSON private key is not part of the design.

Separate deploy/runtime service accounts should retain least privilege. The runtime identity receives only the permissions needed to invoke the specific completion-session Job and read required backend secrets.

Sensitive compute-host values are injected from Google Secret Manager. User AI BYOK credentials remain in Supabase Vault.

## Supabase

Supabase provides:

- authentication;
- user-owned application data;
- Row Level Security;
- analyses and portfolio intelligence;
- completion runs/steps/events/approvals;
- reasoning traces;
- operational learning memories;
- prompt-strategy experiments;
- CI repair attempts;
- continuous repository state/event queue;
- portfolio relationships;
- product-readiness results;
- completion-session state/leases;
- AI BYOK storage through Supabase Vault.

Schema changes are represented by forward-only SQL files in `supabase/migrations/`.

### User-scoped and trusted clients

Normal authenticated requests use user/RLS-scoped Supabase access.

A separate trusted backend client exists for operations that require service privilege, such as Vault store/read/delete RPCs. Trusted backend keys must never enter frontend code, `VITE_*` variables, browser responses, or logs.

### AI BYOK

User-supplied provider keys are stored in Supabase Vault. The preferences row stores safe provider/model metadata and an opaque secret reference. Decrypted keys are available only to trusted server code for provider invocation.

Legacy encrypted key columns may exist for compatibility but are not the destination for new BYOK values.

## GitHub integration

GitHub is both an evidence source and repository-write target.

RepoFinisher uses GitHub for:

- repository metadata;
- trees/file contents;
- base SHA verification;
- checks and Actions evidence;
- deployment/status evidence;
- isolated branches;
- commits;
- draft pull requests.

GitHub Actions remains the normal source of truth for target-repository build/test/check evidence. Generated work should not land directly on a target repository's default branch through the normal autonomous path.

## Repository-completion flow

A normal per-repository completion run follows:

```text
Repository selection
  -> current evidence snapshot
  -> operational-memory retrieval
  -> prompt-strategy resolution
  -> evidence analyst / competing hypotheses
  -> skeptical critic
  -> evidence-selected specialists
  -> principal-plan synthesis
  -> exact coding-plan generation
  -> safety/path/content validation
  -> plan hash + base SHA binding
  -> approval
  -> stale-base check
  -> isolated branch + commit
  -> draft PR
  -> CI + deployment/runtime verification
  -> bounded repair if justified
  -> measured post-run rescore
  -> operational-memory update
```

Finish Portfolio coordinates many such repository boundaries without collapsing them into one all-or-nothing write transaction.

Finish-until-target sessions persist durable state and can repeat bounded iterations through the Cloud Run Job worker.

## Reasoning architecture

The reasoning system is designed to reduce one-shot hallucination and shallow planning.

Major stages:

1. **Evidence collection** — current repo metadata/tree and selected source/config/test/deployment files.
2. **Learning retrieval** — repo-local and cross-repo measured operational memory.
3. **Prompt strategy** — controlled incumbent/challenger strategy assignment.
4. **Evidence analyst** — blockers/root causes with confidence/evidence.
5. **Critic** — rejects unsupported findings and identifies missing evidence/regression risk.
6. **Specialists** — selected from repository evidence rather than always spawning every role.
7. **Principal planner** — smallest ordered completion plan with validation/stop conditions.
8. **Coding agent** — exact file changes constrained by the reasoning plan and write policy.

Immutable safety/approval policy sits outside prompt experimentation.

See `docs/REASONING_AND_LEARNING.md`.

## Approval and rollback boundary

The implementation plan is bound to repository, default branch, base SHA, ordered changes, and plan hash/signature.

Execution fails closed when:

- plan hash/signature does not match;
- approval does not match the stored plan;
- base SHA moved after planning;
- generated paths/content violate safety rules;
- write limits/budgets are exceeded.

Generated work lands on an isolated branch and draft PR. Automatic merge is not the default policy.

## Bounded self-healing CI

When an allowed generated commit fails verification, RepoFinisher can:

- collect failed check/job/log evidence;
- redact likely secret material;
- retrieve prior repair/failure memory;
- diagnose root cause separately from patch generation;
- reject low-confidence guessing;
- generate a minimal safe source/config repair;
- reject identical repeat repairs;
- advance the existing branch;
- re-run verification;
- persist repair evidence/outcomes.

Repairs cannot weaken tests, workflows, security governance, lockfiles, or existing test/lint/typecheck acceptance scripts just to pass.

## Deployment and product verification

`verifyCommitChecks` combines GitHub checks/statuses with deployment-preview evidence when available. Preview probing must preserve SSRF protections. Database/schema changes are only partially validated when no disposable migration/database acceptance signal exists.

For RepoFinisher's own production release, the deploy workflow should verify direct Cloud Run surfaces before custom-domain/DNS cutover. Canonical-domain success is separate evidence from image deployment success.

A green check suite without real runtime evidence is useful but must not be overstated as complete product validation.

## Portfolio intelligence

RepoFinisher supports full-portfolio and deeper cohort analysis, including:

- completion/readiness scoring;
- evidence confidence;
- current/potential valuation ranges;
- commercialization heuristics;
- replacement-cost planning estimates;
- confidence-adjusted portfolio totals;
- duplicate-IP overlap discounts;
- bounded synergy adjustments;
- tiered deeper analysis;
- portfolio relationship graph signals.

Commercial/market values remain estimates unless independently verified evidence exists.

## External LLM handoff

RepoFinisher can generate a provider-neutral completion handoff and optional provider-specific formatting for external coding agents.

The handoff should contain the assessed SHA, current state, evidence-backed blockers, ordered work, risks, validation requirements, security/approval boundaries, and the same Definition of Done used internally. If HEAD moved, the external agent must reassess.

See `docs/EXTERNAL_LLM_HANDOFFS.md`.

## Source of truth

Stable architecture is defined by current `main`, this file, `README.md`, `AGENTS.md`, `docs/DECISIONS.md`, and `docs/OPERATIONS.md`. Time-sensitive rollout state belongs in `docs/PROJECT_STATE.md`.

When code/workflows and documentation disagree, verify current `main` and fix the documentation rather than preserving architecture drift.