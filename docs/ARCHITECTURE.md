# RepoFinisher Architecture

This document describes the intended production architecture and the major control/data flows. It is more stable than `docs/PROJECT_STATE.md`; use the project-state document for time-sensitive deployment status.

## System boundaries

RepoFinisher is a pnpm/TypeScript monorepo with five primary runtime concerns:

1. **Frontend SPA** — `artifacts/repo-finisher`
2. **API/control plane** — `artifacts/api-server`
3. **Long-running completion workers** — Cloud Run Jobs using the API-server worker entrypoint
4. **Shared repository-intelligence logic** — `lib/`
5. **Persistent state/security boundary** — Supabase schema in `supabase/migrations/`

The approved production hosting contract is:

```text
Browser
  |
  v
Netlify (React/Vite SPA)
  |
  | HTTPS + Supabase bearer token
  v
Google Cloud Run (Express API / control plane)
  |                    \
  |                     \-> Cloud Run Jobs (long-running completion work)
  |                              |
  |                              +-> GitHub REST / Actions / PRs / checks
  |                              +-> configured AI provider
  |
  +-> Supabase (Auth/RLS/DB/Vault/durable job state)
  +-> GitHub (repository evidence and writes)
```

GitHub Actions provides repository CI/build/test evidence and deploys the RepoFinisher Cloud Run service/job through Google Workload Identity Federation.

**Vercel is not an approved production target.** Render is retained only as a temporary rollback target during the Cloud Run cutover and is not the target architecture.

## Frontend

The production web app lives in `artifacts/repo-finisher`.

Responsibilities:

- Supabase user authentication/session handling.
- Portfolio and repository analysis UI.
- Settings and AI provider/model management.
- Exact-plan approval UX.
- Per-repo finishing controls.
- Finish Portfolio orchestration controls.
- External-LLM prompt generation/copy UX.
- Learning/audit/assurance visibility where surfaced.

The frontend communicates with the persistent API through `VITE_API_BASE_URL`. The target is the deployed Cloud Run API URL. During the migration only, the existing Render API remains the known-good rollback endpoint until Cloud Run passes direct health/authentication/CORS checks and the Netlify frontend is deliberately cut over.

The frontend also communicates directly with Supabase for user-scoped auth/data paths as designed. RLS remains the authorization boundary for direct browser database access.

## API / control plane

The API lives in `artifacts/api-server` and is an Express application built to `dist/index.mjs`.

The API owns trusted control-plane operations including:

- request authentication and authorization,
- GitHub credential use,
- repository inspection and metadata access,
- multi-agent reasoning/orchestration,
- exact-plan creation,
- repository-write authorization,
- draft PR orchestration,
- portfolio completion orchestration,
- post-run re-scoring,
- operational-learning persistence,
- Supabase Vault AI credential access,
- service-role-only operations,
- dispatch of long-running completion sessions to Cloud Run Jobs.

The API validates user identity with Supabase before trusting authenticated requests.

The API is intentionally not the permanent home for heavy or long-lived execution. Work that may outlive an HTTP request or materially benefit from independent CPU/memory allocation should move to the worker plane while preserving durable state in Supabase.

## Cloud Run worker plane

Finish-until-target completion sessions execute through the `completion-session-job` entrypoint built from the same immutable container image as the API.

The API dispatches the Cloud Run Job using its attached Google runtime service-account identity and the Cloud Run v2 Jobs API. Per execution, it passes only:

```text
REPOFINISHER_USER_ID
REPOFINISHER_SESSION_ID
```

Repository state, approval state, progress, GitHub credentials, AI credentials, CI state, and repair history are loaded from durable trusted storage rather than serialized into the job request.

The worker reuses the existing completion-session lease/heartbeat mechanism and the API scheduler suppresses duplicate dispatch while a live/recent worker is detected. This prevents ordinary UI polling or retries from producing duplicate paid executions or duplicate branch writes.

The worker can progress a durable session through planning, execution, CI verification, bounded repair, re-scoring, and subsequent bounded iterations. If its execution budget is reached, it yields without fabricating completion; the same durable session can be dispatched again.

The initial worker allocation is larger than the control plane and exists only while work is running. Resource sizing should be tuned from measured CPU, memory, duration, failure, and queue data rather than by keeping an oversized API instance permanently alive.

## Supabase

Supabase provides:

- authentication,
- user-owned application data,
- Row Level Security,
- completion-run persistence,
- analysis and portfolio intelligence,
- reasoning traces,
- operational learning memories,
- prompt-strategy experiments,
- CI repair attempts,
- continuous-repository settings/event queue,
- portfolio relationships,
- product-readiness results,
- completion-session state and worker leases,
- encrypted AI BYOK storage through Supabase Vault.

Schema changes are represented by forward-only SQL files in `supabase/migrations/`.

### User-scoped vs service-role clients

Normal authenticated requests use a user/RLS-scoped Supabase client.

A separate service-role client exists only for backend operations that require trusted privilege, including Vault credential operations. The service-role key must never enter the browser or a `VITE_*` variable.

### AI BYOK secret storage

User-supplied provider credentials are stored in Supabase Vault.

The `user_preferences` row stores an opaque Vault secret identifier, not the decrypted provider key. Server-side service-role RPCs store/read/delete the corresponding Vault secret. `anon` and `authenticated` roles must not receive execute permission on those privileged Vault functions.

The legacy `custom_ai_key` column remains a compatibility fallback for old encrypted rows but is not the intended destination for new AI BYOK credentials.

## Google Cloud identity and secrets

GitHub Actions authenticates to Google Cloud with GitHub OIDC + Google Workload Identity Federation. A long-lived Google service-account JSON key is not part of the deployment design.

The Cloud Run API and Job use a dedicated runtime service account. Backend secrets required by the compute host are injected from Google Secret Manager. During migration, the existing production `SECRET_ENCRYPTION_KEY` and `PLAN_SIGNING_SECRET` must be preserved so stored credentials and in-flight approved plans are not invalidated simply because the compute host changed.

AI BYOK values remain in Supabase Vault and are not copied into browser configuration or job-dispatch payloads.

## GitHub integration

GitHub is both an evidence source and the repository-write target.

RepoFinisher uses GitHub for:

- repository metadata,
- trees and file contents,
- commit/base SHA verification,
- checks and Actions evidence,
- deployment/status evidence,
- isolated branches,
- commits,
- draft pull requests.

GitHub Actions remains the normal source of truth for target-repository CI/build/test evidence. RepoFinisher does not need to keep every possible repository build toolchain permanently installed in the control-plane service.

Generated work should never land directly on a target repository's default branch through the normal autonomous flow.

## Repository-completion flow

A normal per-repository completion run follows this control flow:

```text
Repository selection
  -> current evidence snapshot
  -> operational memory retrieval
  -> prompt-strategy resolution
  -> evidence analyst
  -> skeptical critic
  -> evidence-selected specialists
  -> principal plan synthesis
  -> coding plan generation
  -> safety/path/content validation
  -> exact plan hash + base SHA binding
  -> approval
  -> stale-base check
  -> isolated branch + commit
  -> draft PR
  -> CI + deployment-preview verification
  -> bounded repair if needed
  -> measured post-run rescore
  -> operational memory update
```

For a finish-until-target session, the control plane creates durable session state and dispatches the Cloud Run worker. The worker repeats the bounded `reason -> implement -> verify -> repair -> rescore` cycle until targets are met or a policy, risk, budget, no-progress, or execution stop condition applies.

The key property is that reasoning and repository writes are separate phases. An agent may reason broadly, but only a validated bounded exact plan becomes write authority.

## Reasoning architecture

The reasoning system is designed to reduce one-shot hallucination and shallow planning.

Major stages:

1. **Evidence collection** — current repo metadata/tree and selected source/config/test/deployment files.
2. **Learning retrieval** — repo-local and cross-repo measured operational memories.
3. **Prompt strategy** — incumbent/challenger strategy selection under controlled experimentation.
4. **Evidence analyst** — identifies blockers and root causes with confidence/evidence.
5. **Critic** — rejects unsupported findings, identifies missing evidence and regression risk.
6. **Specialists** — selected from repository evidence rather than always spawning every role.
7. **Principal planner** — synthesizes the smallest ordered completion plan with validation and stop conditions.
8. **Coding agent** — turns the approved reasoning plan into exact file changes.

See `docs/REASONING_AND_LEARNING.md` for details.

## Approval and rollback boundary

The exact implementation plan includes the repository, default branch, base SHA, ordered changes, and plan hash.

Execution must fail closed when:

- the plan hash does not match,
- the approved hash does not match the stored plan,
- the repository base SHA moved after planning,
- generated paths/content violate safety rules,
- write limits are exceeded.

Generated work is committed on an isolated branch and opened as a draft pull request. Automatic merge is not the default policy.

## Self-healing CI

If a generated commit fails required verification and the run permits bounded repair, RepoFinisher can:

- collect failed check/job/log evidence,
- redact likely secret material,
- retrieve prior repair/failure memories,
- diagnose a root cause separately from patch generation,
- reject low-confidence guessing,
- generate a minimal source/config repair,
- reject identical repeat repairs,
- advance the existing RepoFinisher branch,
- re-run verification,
- persist repair evidence and outcomes.

Repairs cannot weaken tests, workflows, security governance, lockfiles, or existing test/lint/typecheck acceptance scripts just to pass.

## Deployment verification

`verifyCommitChecks` combines GitHub check/status evidence with isolated deployment-preview evidence when available.

Preview probing applies SSRF protections and recognizes supported hosted-preview providers. Database/schema changes are explicitly marked as only partially validated when no disposable database/migration check is present.

A passing check suite without a real runtime surface is useful evidence but should not be overstated as complete product validation.

## Portfolio intelligence

RepoFinisher supports full-portfolio scoring and deeper cohorts.

The intelligence system includes:

- deterministic completion/readiness scoring,
- evidence confidence,
- current/potential valuation ranges,
- commercialization probability heuristics,
- replacement-cost planning estimates,
- confidence-adjusted portfolio totals,
- duplicate-IP overlap discounting,
- bounded synergy adjustments,
- tiered deep analysis for selected cohorts,
- portfolio relationship graph signals.

Commercial/market estimates must remain clearly labeled as estimates unless independently verified evidence exists.

## External LLM handoff

For each repository, RepoFinisher can create a provider-neutral completion handoff and optional provider-specific formatting for external coding agents.

The handoff is generated from the same current repository assessment and should include:

- assessed SHA,
- current completion/readiness state,
- root-cause blockers,
- ordered plan,
- risks,
- validation requirements,
- definition of done,
- instruction to re-assess when the repository has moved.

This path complements the internal completion engine; it is not allowed to become a reason to weaken the internal engine.

## Continuous Repository Mode

Continuous Repository Mode maintains per-repository watch settings and a durable event queue.

Repository events are deduplicated and can trigger re-reasoning. Bounded autonomous finishing requires an explicit higher-autonomy acknowledgement. Continuous mode does not imply automatic merge permission.

## Observability

Sentry is optional but recommended for production frontend/API exception visibility and source-mapped diagnostics. Google Cloud Run/Job logs provide compute-plane runtime evidence. See `docs/sentry-observability.md`.

Completion runs also have product-level observability through persisted:

- run events,
- steps,
- reasoning traces,
- repair attempts,
- outcome metrics,
- learning memories,
- assurance/readiness results.

## Known architectural debt and migration state

Track current implementation gaps in `docs/PROJECT_STATE.md` rather than hiding them.

A residual `@vercel/functions` dependency may remain in the API solely for compatibility/background-lifecycle behavior. It is not part of the approved hosting architecture and should be removed once its behavior is replaced safely.

During the Cloud Run migration, Render remains intentionally available as a rollback endpoint until direct Cloud Run health/auth/CORS, Netlify cutover, production smoke, and at least one real completion-session Job have been verified. Do not interpret that temporary rollback endpoint as the architecture reverting to Render.

The long-term goal is a provider-neutral application/control layer with explicit ephemeral worker boundaries and no Vercel runtime dependency.