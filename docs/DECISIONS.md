# RepoFinisher Architecture and Product Decisions

This is a lightweight decision log for choices that should not be casually reversed by a later coding session.

If a decision changes, update this file in the same PR and explain why.

## D001 — Production hosting is Netlify + Render + Supabase + GitHub

**Status:** accepted

RepoFinisher production hosting is:

- Netlify for the frontend SPA,
- Render for the persistent API and long-running agent work,
- Supabase for auth/database/RLS/Vault,
- GitHub for source/CI/PRs.

**Vercel is explicitly not an approved deployment target.**

Rationale: RepoFinisher performs multi-step reasoning, portfolio orchestration, and repair work that benefits from a persistent API rather than fitting the core backend into short synchronous frontend/serverless execution windows. A prior Vercel production outage/migration also made hosting ambiguity an operational risk.

Consequences:

- Do not add Vercel hosting config.
- CI should continue guarding against Vercel hosting artifacts.
- Residual runtime compatibility dependencies should be removed when safely replaceable.

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

- current evidence collection,
- multiple/root-cause hypotheses where appropriate,
- skeptical critique,
- evidence-selected specialists,
- principal-plan synthesis,
- explicit validation and stop conditions,

over one large undifferentiated prompt.

Rationale: reduce shallow planning, unsupported assumptions, and repeated error patterns.

## D006 — AI BYOK credentials live in Supabase Vault

**Status:** accepted

New user-supplied AI provider keys are stored in Supabase Vault through service-role-only backend functions. The browser stores/sees only safe provider/model/configuration metadata and an opaque secret reference indirectly through server-managed state.

Rationale: decouple AI credential storage from host-specific encryption keys and avoid plaintext/browser exposure.

The legacy `custom_ai_key` path is compatibility-only.

## D007 — External LLM prompts complement, not replace, RepoFinisher

**Status:** accepted

Each repository may have a detailed current-state completion handoff for an external coding agent (Codex, Claude Code, Gemini CLI, or neutral target).

The handoff should reuse RepoFinisher's assessment/evidence and definition of done. It is not an excuse to leave RepoFinisher's internal completion engine weaker.

Rationale: provide portability and operator choice while preserving the product's core autonomous capability.

## D008 — Passing CI is not equivalent to a finished repository

**Status:** accepted

A successful implementation run should be re-scored for completion and production readiness. Remaining user-flow, security, deployment, data, payment, accessibility, or operational blockers must remain visible.

The intended architecture includes repeated bounded iterations until a target is reached or a no-progress/risk/budget stop occurs.

Rationale: a syntactically/build-correct PR can still leave the product substantially unfinished.

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

Rationale: RepoFinisher is complex enough that undocumented architecture drift directly causes production and agent errors.