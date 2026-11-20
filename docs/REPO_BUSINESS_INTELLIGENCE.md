# Repository Business Intelligence

RepoFinisher answers three questions per repository, and one per builder model:

1. **Where is this repository actually at?** — stage, letter grade, weighted dimensions.
2. **Is anyone likely to want it?** — a demand index with named drivers and evidence gaps.
3. **What is a fair market value today, and what could it be worth finished?** — a present-value
   range, a labeled potential scenario, and the value unlocked by finishing.
4. **What exact prompt should a builder model receive so it comes back finished?** — a finality
   contract plus one self-contained prompt per improvement.

## Where it lives

| Layer | File |
| --- | --- |
| Deterministic grading, demand, valuation, finality | `artifacts/api-server/src/lib/repo-business-engine.ts` |
| Improvement rules and prompt composition | `artifacts/api-server/src/lib/builder-prompt-composer.ts` |
| HTTP surface | `artifacts/api-server/src/routes/repo-business.ts` |
| UI | `artifacts/repo-finisher/src/components/repo-business-view.tsx` (Analysis → **Business Grade**) |

## Endpoints

```text
GET  /api/repo-business/:analysisId
GET  /api/repo-business/:analysisId/detail?repo=owner/name&live=1&suggestions=18
POST /api/repo-business/:analysisId/prompt   { repo, target, topN, useAi }
```

All three require an authenticated Supabase session. The detail and prompt routes
enrich stored analysis evidence with a live GitHub tree read when a GitHub
connection exists; if GitHub is rate-limited or the token is dead, they degrade to
stored evidence and say so in `evidenceSource`.

## Method

Everything is deterministic and pure. Model output is an **input** (measured
completion, readiness, market need, demand, competitive pressure, uniqueness), never
the arithmetic. That is deliberate: a valuation that moves because a model's mood
moved is not a valuation.

### Grade

Ten weighted dimensions: completeness, production readiness, engineering quality,
security posture, deployability, documentation, market need, differentiation,
monetization readiness, and traction.

- **Measured** values from the latest portfolio analysis win.
- **Derived** values come from structural evidence (tests, CI, container/deploy
  config, env template, migrations, auth/payments/frontend/backend signals).
- **Missing** evidence is excluded from the weighted sum and renormalizes the
  remaining weights. It is never scored as if it were passing.

An **evidence ceiling** caps the overall grade: no tests caps at 64, no CI at 72, no
README at 78, archived at 40. A repository cannot be graded production-ready on
evidence it does not have.

Stages: `concept` → `scaffold` → `functional-mvp` → `beta` → `launch-ready` → `production`.

### Demand

A 0–100 index from market need (0.28), observed demand (0.24), traction (0.18),
differentiation (0.16), and competitive room (0.14). Bands: `proven` ≥ 75,
`emerging` ≥ 58, `speculative` ≥ 38, otherwise `unproven`.

Absent evidence uses deliberately sub-speculative defaults. An unmeasured repository
reads as **unproven** until a portfolio scan produces real signals — never as average.

### Fair market value

Replacement cost is `estimated total engineering hours × $95/hour`. Present value
discounts that by completion, quality, and demand:

```text
present = replacementCost × completion × (0.55 + 0.45 × quality) × (0.6 + 0.6 × demand)
```

Potential value prices the finished product off the same replacement cost, with
demand, monetization, and readiness carrying the multiple:

```text
potential = replacementCost × (0.85 + 0.55 × demand) × (0.75 + 0.35 × monetization) × (0.85 + 0.3 × readiness)
```

Measured ranges from the analysis replace the modelled present/potential ranges when
they exist, so the engine never overwrites a better measurement with a heuristic.
Potential is always ≥ present, and the gap is the **value unlocked by finishing**.

Confidence follows *measured* evidence only. A grade built entirely from inferred
missing files reports low confidence, and says so.

### Finality

`finality.score` blends the overall grade with how far each dimension is from its
target. Unmeasured dimensions are gaps, not passes. `isFinished` requires a score
of at least 88, no critical gap, and no blockers.

## Improvement suggestions

Rules in `builder-prompt-composer.ts` target the gaps the repository actually has
(tests, CI, deploy, README, env template, license, auth boundaries, billing,
observability, UI states, responsiveness, accessibility, API validation, rate
limits, graceful shutdown, migrations, backup/restore, pricing surface, onboarding,
analytics, dependency hygiene, static gates, smoke path, operational failure
definitions, runbook, releases, secret scan, model eval harness).

Baseline hygiene rules always apply, so every repository gets a substantial list
(typically 12–20 items, capped at 24 after ranking). Suggestions from the latest
portfolio analysis are folded in and de-duplicated by title. Items are ranked by
impact per unit of effort.

Every suggestion carries:

- the problem, the action, and why it moves value;
- binary acceptance criteria;
- the evidence that triggered it;
- a **self-contained builder prompt** with its own acceptance criteria, scope bound,
  verification requirement, and finality contract.

## Finality prompt

`composeFinalityPrompt` emits a twelve-section contract: role, baseline, current
business state, hard constraints, ordered work with acceptance criteria, known
blockers, execution loop, verification gates, stop conditions, Definition of Done,
required final report, and anti-patterns — plus tool guidance for the selected target
(`provider-neutral`, `codex`, `claude-code`, `gemini-cli`).

`scorePromptQuality` is an executable rubric, not a vibe check. It verifies the
prompt contains each clause (role, baseline, state, scope, ordered work, loop,
verification, stop conditions, Definition of Done, final report, anti-patterns) and
returns a weighted 0–100 score. The test suite fails if the composer ever drops one.

`useAi: true` asks the user's configured model to improve clarity only. The model
may not remove a constraint, an acceptance criterion, a verification gate, or soften
the Definition of Done, and an incomplete response falls back to the reviewed
deterministic prompt.
