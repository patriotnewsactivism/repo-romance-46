# Investor, Growth, and Evidence-Backed Improvement Tools

RepoFinisher separates analysis, external market research, planning estimates, and repository writes. This document defines the new investor/export and growth tooling and the safety contract that applies when a user chooses to implement a suggested change.

## Investor PDF export

After Full Portfolio Value has produced repository-level investment intelligence, the Confidence-adjusted Portfolio Value panel exposes **Export investor PDF**.

The authenticated PDF endpoint is:

`GET /api/investor-report/:analysisId.pdf`

The report is generated from current persisted analysis evidence plus a fresh confidence-adjusted Portfolio V2 calculation. It includes:

- the finish-first recommendation;
- repository coverage;
- gross standalone and confidence-adjusted current value;
- confidence-adjusted potential scenarios;
- replacement cost;
- duplicate-IP discount and capped synergy;
- top finish-first repositories;
- recorded recommendation/roadmap work when available;
- investor diligence priorities;
- explicit valuation limitations and disclaimers.

The PDF generator is dependency-free and server-side. It does not send analysis data to a third-party PDF service.

## Live market and competitor research

Each recommendation can run **Research market & growth**.

RepoFinisher uses live web research only when `TAVILY_API_KEY` is configured on the trusted backend. `TAVILY_SEARCH_DEPTH` controls the Tavily search depth and defaults to `advanced`.

Hard evidence rules:

1. Named competitors, URLs, customer pricing, product features, plans, and positioning may only be shown when a returned external source supports the claim.
2. Evidence URLs returned by the model are checked against the actual source packet before the result is returned to the browser.
3. When live research is unavailable, the competitor list is forced empty and the UI says external research is unavailable.
4. RepoFinisher must never convert GitHub metadata or an LLM guess into a claim of verified TAM, market share, revenue, customers, or competitive saturation.

## Feature opportunity analysis

Growth analysis can recommend multiple feature opportunities. Every suggestion includes:

- why the feature matters;
- a concrete implementation summary;
- a desirability score;
- an incremental software/IP value-lift planning range;
- low/base/high monthly revenue scenarios and automatically displayed annual equivalents;
- explicit assumptions;
- competitor/market gap;
- objective acceptance checks;
- regression risks;
- source URLs when external evidence contributed to the recommendation.

Revenue figures are **scenarios, not observed revenue and not forecasts**. Value-lift figures are planning estimates, not appraisals or guaranteed transaction value.

## Safe feature implementation

Selecting **Plan implementation** does not immediately write to the target repository.

The sequence is:

1. generate a fresh evidence-based agentic plan pinned to the current base SHA;
2. inject feature-specific safety requirements and acceptance checks;
3. present every proposed file change and the exact plan hash to the user;
4. require explicit approval of that exact plan;
5. execute on an isolated branch;
6. open/use a draft PR;
7. verify CI/runtime evidence where available;
8. permit only bounded evidence-driven repair under the normal RepoFinisher safety contract;
9. never auto-merge by default.

A feature implementation instruction explicitly forbids weakening tests, authentication, authorization, permissions, security, data integrity, CI, or deployment controls just to make a change pass.

## Documentation reconciliation

Recommendation cards expose a separate **Documentation reconciliation** action for README, `AGENTS.md`, plans/roadmaps, and `docs/*.md`.

Documentation mode is intentionally different from a normal feature or finish run:

- the planner must inspect implemented source, tests, workflows, migrations, environment contracts, and deployment configuration before documenting behavior;
- planned, mocked, partial, or unverified behavior cannot be described as complete;
- stale plans should distinguish completed work from remaining evidence-backed work;
- a server-side path guard rejects the plan if it attempts to change application source, tests, workflows, migrations, lockfiles, runtime configuration, or other non-documentation paths;
- deletions are rejected in documentation-only mode;
- no repository write occurs when the guard rejects the generated plan.

This mode exists so README/AGENTS/PLAN/ROADMAP content can evolve with the actual product without allowing a documentation request to silently modify runtime code.

## Finish until target

RepoFinisher already has a durable multi-iteration completion-session engine. The frontend now exposes it as **Finish until target**.

After a portfolio analysis completes, RepoFinisher automatically kicks off Investment Intelligence for the top ranked repositories (soft-capped for budget). That gives finish-until-target the measured completion/readiness baseline it requires, without a second manual valuation click. You can still refresh Full Portfolio Value manually.

Investment Intelligence now also emits abundant deterministic **value-improvement suggestions** from completion/readiness gaps (auth, tests, deploy evidence ceilings, core functionality, etc.), merged into finish next-steps. These are evidence-backed gap closures, not invented market claims.

The default UI targets are:

- completion: 95%;
- production readiness: 90%;
- maximum iterations: 5;
- no-progress stop: 2 iterations.

The controller re-assesses and re-scores after each bounded iteration. It stops when the targets are met or when safety, no-progress, budget, iteration, or evidence constraints require a stop. Existing branch/PR evidence is preserved for inspection, and automatic merge remains disabled.

Green CI alone is not a sufficient definition of finished. Completion/readiness must continue to account for relevant user journeys, authentication/authorization, data/schema/migrations, payments where applicable, deployment/runtime seams, security, tests, observability, accessibility, and documentation.

## Capability guide

The Full Portfolio Value screen includes a collapsible plain-language capability guide that identifies whether each tool is:

- read-only analysis;
- live/source-backed research;
- planning only;
- a draft-PR repository write;
- protected by an exact-plan or documentation-only guard.

The goal is that users can understand what a click will do before authorizing it.

The guide is expanded by default on **Finish, Value & Reports**. Market research, feature opportunities, documentation reconciliation, and plan-first implementation are also rendered directly on every ranked repository rather than being hidden only inside an expanded recommendation card.

## Full portfolio scope

Settings offers explicit 50, 100, 250, 500, and **All accessible repositories** scopes. All maps to a bounded maximum of 1,000 repositories per run and uses paginated GitHub discovery. This is a product/runtime safety bound, not a model-specific repository cap. The selected AI model does not silently reduce the requested repository scope; large portfolios use the existing tiered evidence/deep-digest strategy and report exact scored/requested coverage.
