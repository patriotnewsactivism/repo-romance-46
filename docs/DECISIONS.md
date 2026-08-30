# RepoFinisher Architecture and Product Decisions

This is the durable decision log for choices that should not be casually reversed by a later coding session.

If a decision changes, update this file in the same PR and explain why.

## D001 — Production runtime is Google Cloud Run + Supabase + GitHub

**Status:** accepted; supersedes the earlier Netlify + Render and Netlify + Cloud Run transitional topologies

Canonical production runtime is:

- Google Cloud Run service `repofinisher-web` for the frontend SPA;
- Google Cloud Run service `repofinisher-api` for the API/control plane;
- Google Cloud Run Job `repofinisher-completion-session` for long-running finish-until-target work;
- GitHub Actions for CI/build/test and Google Cloud deployment;
- Google Artifact Registry for immutable images;
- Google Secret Manager for backend compute-host secrets;
- Supabase for auth/database/RLS/Vault/durable completion state;
- GitHub for source/branches/draft PRs/check evidence;
- Cloudflare for canonical custom-domain DNS;
- Sentry/Cloud Logging for observability when configured.

**Vercel is explicitly not an approved deployment target.**

`netlify.toml` and the former Render service are legacy migration/rollback artifacts, not current production targets. They may only be reactivated through an explicit, verified rollback decision.

Rationale: RepoFinisher benefits from one provider-neutral containerized execution platform for the web/control plane while keeping heavy, long-running completion work independently schedulable. Cloud Run Jobs allocate larger resources only while work exists. Durable Supabase state prevents process lifetime, retry, or UI polling from becoming the authoritative execution state.

Consequences:

- Do not add Vercel hosting configuration.
- Keep CI's non-Vercel hosting guard.
- Deploy immutable SHA-tagged images through GitHub OIDC + Workload Identity Federation; do not use long-lived Google service-account JSON keys.
- Keep long-running worker state durable in Supabase and protect against duplicate worker/branch writes with leases/heartbeats.
- Verify direct Cloud Run surfaces before changing custom-domain DNS.
- Treat Cloudflare domain mapping/DNS as part of production release evidence.
- Keep rollback artifacts only while they have a defined, tested rollback purpose; remove them when obsolete.

## D002 — Exact plan approval is a write boundary

**Status:** accepted

Reasoning may be broad, but repository writes must be based on a validated exact plan bound to a base SHA and plan hash.

Unless the user explicitly chose a product-defined bounded higher-autonomy mode, exact-plan approval is required before execution.

Generated changes belong on an isolated branch with a draft PR. Automatic merge is disabled by default.

Rationale: keep AI reasoning separate from write authority, preserve auditability, stale-base detection, and rollback.

## D003 — Self-healing fixes implementation, never acceptance criteria

**Status:** accepted

Bounded repair can modify safe source/configuration when failure evidence supports a root cause.

It cannot weaken tests, CI/security governance, required scripts/checks, or secret protections merely to obtain green verification.

Rationale: a checker-gaming repair is a false success and teaches the wrong behavior.

## D004 — Learning is measured operational learning

**Status:** accepted

RepoFinisher's "learning" means persistent measured outcomes and reusable operational memory, not autonomous retraining of model weights.

Measured evidence may influence planning strategy and prompt experiments. Safety/approval/permission policy remains immutable and outside the experiment surface.

Rationale: make improvement auditable and tied to real results.

## D005 — Use multi-stage reasoning for meaningful completion work

**Status:** accepted

Repository completion should favor:

- current evidence collection;
- multiple/root-cause hypotheses when appropriate;
- skeptical critique;
- evidence-selected specialists;
- principal-plan synthesis;
- explicit validation and stop conditions;

over one large undifferentiated prompt.

Rationale: reduce shallow planning, unsupported assumptions, and repeated error patterns.

## D006 — AI BYOK credentials live in Supabase Vault

**Status:** accepted

New user-supplied AI provider keys are stored in Supabase Vault through service-role-only backend functions. The browser only receives safe provider/model/configuration metadata; it never receives the decrypted provider key.

The legacy `custom_ai_key` path is compatibility-only.

Rationale: decouple AI credential storage from compute-host-specific encryption and avoid plaintext/browser exposure.

## D007 — External LLM prompts complement, not replace, RepoFinisher

**Status:** accepted

Each repository may have a detailed current-state completion handoff for an external coding agent such as Codex, Claude Code, Gemini CLI, or a provider-neutral target.

The handoff must reuse RepoFinisher's assessment/evidence and Definition of Done. It is not an excuse to leave RepoFinisher's internal completion engine weaker.

Rationale: provide portability/operator choice while preserving the product's core autonomous capability.

## D008 — Passing CI is not equivalent to a finished repository

**Status:** accepted

A successful implementation run should be re-scored for completion and production readiness. Remaining user-flow, security, deployment, data, payment, accessibility, or operational blockers must remain visible.

The intended architecture supports repeated bounded iterations until a target is reached or a no-progress/risk/budget/policy stop occurs.

Rationale: a build-correct PR can still leave the product substantially unfinished.

## D009 — Portfolio orchestration preserves per-repository failure boundaries

**Status:** accepted

Finish Portfolio may coordinate many repositories, but each repository retains its own plan hash, branch, PR, CI state, repair attempts, budget, and outcome telemetry.

A failure in one repository must not invalidate successful siblings or cause portfolio state to fabricate completion.

## D010 — Commercial/valuation outputs are estimates unless independently verified

**Status:** accepted

Completion/value/commercialization heuristics may support prioritization, but they must not present revenue, customers, TAM, market share, competitive saturation, or demand as verified facts without external evidence.

Replacement cost is a planning estimate, not fair market value.

## D011 — Database changes are migration-driven and least-privilege

**Status:** accepted

Production schema changes belong in `supabase/migrations/`, use forward corrective migrations, preserve RLS, and grant the minimum required capabilities.

Service-role-only Vault functions must not be exposed to browser roles.

## D012 — Documentation is part of the production contract

**Status:** accepted

Architecture, hosting, security storage, environment variables, autonomy policy, and operational behavior changes must update canonical documentation in the same PR.

Model-specific instruction files remain pointers to `AGENTS.md` rather than divergent policies.

Rationale: undocumented architecture drift directly causes production and agent errors.

## D013 — Long-running completion execution must be durable and independently schedulable

**Status:** accepted

Finish-until-target sessions must persist authoritative progress, leases, iterations, branch/PR state, CI state, and stop conditions outside the worker process. Cloud Run Jobs may retry or be re-dispatched, but a new worker execution must resume durable state rather than replay completed repository writes.

An in-process fallback may exist for local development or controlled recovery, but production long-running completion work should use the worker plane while Cloud Run Jobs are configured.

Rationale: ephemeral compute is economical only if process death, retry, UI polling, and execution time limits cannot corrupt progress or duplicate writes.

## D014 — Custom-domain cutover is a release step, not a source-code assumption

**Status:** accepted

The canonical domain is `repofinisher.donmatthews.live`, but source code alone does not prove that the domain maps to the intended current revision.

The deployment workflow may manage Cloud Run domain mapping and Cloudflare DNS only after direct service verification. Release/incident reporting must distinguish direct-host health from canonical-domain verification.

Rationale: DNS/certificate/domain state can lag or diverge independently of a successful image deployment.