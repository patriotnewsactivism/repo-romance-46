# Reasoning, Learning, and Self-Healing

RepoFinisher's core product claim should be grounded in measurable behavior: it should reason better over time because it retrieves evidence, critiques itself, records outcomes, and changes planning strategy when measured results support the change.

It must not claim silent model-weight retraining.

## Goals

The reasoning system should:

- diagnose the actual current repository instead of relying on generic best practices,
- identify root causes before patches,
- make uncertainty visible,
- separate evidence from inference,
- use specialists only when repository evidence justifies them,
- validate proposed work against real acceptance signals,
- learn from success and failure,
- avoid repeating failed strategies unchanged,
- continue iterating when the repository remains materially unfinished.

## Reasoning pipeline

The default planning flow is designed as a sequence of bounded roles rather than a single huge prompt.

### 1. Evidence collection

Collect current evidence from the target repository and commit:

- repository metadata,
- default branch and exact HEAD SHA,
- tree structure,
- selected package/build/config files,
- CI workflows,
- tests,
- deployment configuration,
- migrations/schema/auth/payment/security surfaces when present,
- existing analysis/intelligence context,
- requested next steps.

Reasoning should fail or reduce confidence when the repository tree is incomplete/truncated rather than pretending that missing evidence is complete evidence.

### 2. Operational memory retrieval

Load high-confidence memories relevant to the repository and task.

Memories can be:

- repo-local,
- cross-repo,
- portfolio-level.

Examples:

- a prompt strategy that repeatedly improved completion score,
- a CI root cause/repair pattern that was later verified,
- a deployment failure mode that repeatedly appeared,
- a recurring architecture/configuration mistake.

Memory confidence should be based on samples/outcomes, not merely on how recently text was written.

### 3. Prompt strategy selection

RepoFinisher supports controlled strategy experiments.

An experiment has an incumbent and optional challenger. Challenger traffic is bounded. Promotion requires sufficient scored runs, a practical improvement, confidence evidence, and regression safety.

Early rejection should occur when the challenger materially harms completion delta, outcome score, or poor-outcome rate.

Prompt experiments may change planning technique. They may not change the immutable safety/approval policy.

### 4. Evidence analyst

The analyst identifies:

- blocker,
- severity,
- confidence,
- supporting evidence,
- root cause,
- recommended action,
- validation requirement.

It should also list unknowns rather than filling gaps with invented facts.

### 5. Skeptical critic

The critic attacks the diagnosis.

It should:

- reject unsupported findings,
- identify missing evidence,
- identify likely regression risk,
- challenge over-broad changes,
- protect working behavior,
- reduce confidence when the evidence does not support certainty.

### 6. Dynamic specialists

Specialists should be selected from evidence rather than always spawning every role.

Possible specialist lenses include:

- frontend/UX,
- backend/API,
- database/data model,
- DevOps/deployment,
- security/auth,
- payments/growth,
- accessibility,
- QA/reliability,
- observability,
- native/mobile,
- AI/data where supported by the current catalog.

The selection logic should avoid triggering a specialist from generic words like `service` or `build` without stronger evidence.

### 7. Principal planner

The planner synthesizes:

- accepted findings,
- critic feedback,
- specialist feedback,
- measured memory,
- prompt-strategy guidance,
- known constraints.

The resulting plan should be ordered by prerequisites and expected completion gain, with a validation path and stop conditions.

### 8. Coding agent

Only after reasoning does the coding agent turn the plan into exact file changes.

The coding agent must still pass deterministic safety validation. Reasoning confidence does not grant permission to bypass path/content limits, protected files, approval hashes, or stale-base checks.

## Immutable safety policy

Reasoning/learning is allowed to improve strategy only.

It may not learn or experiment its way around:

- exact-plan approval or explicit bounded autonomy acknowledgement,
- no-auto-merge default,
- secret handling,
- branch/PR rollback boundaries,
- CI/test/security protections,
- permission boundaries,
- stale-base checks,
- path/content safety limits.

This policy should remain represented independently of mutable prompt strategy.

## Measured outcome loop

After a terminal completion run, RepoFinisher should record and use measurements such as:

- run status,
- outcome score,
- completion delta,
- production-readiness delta,
- finish-first score delta,
- commercialization-probability delta,
- remaining-work delta,
- present-value midpoint delta,
- duration,
- files affected,
- prompt version,
- reasoning trace,
- specialists,
- CI/deployment result.

A successful result updates the strategy/memory positively. A weak/failed result creates or reinforces a failure memory and should discourage repeating the same approach unchanged.

## Durable operational memory

Operational memory should remain queryable and auditable.

Useful fields include:

- scope,
- category,
- memory key,
- observation,
- recommendation,
- confidence,
- sample count,
- successes/failures,
- average outcome score,
- average completion/readiness delta,
- evidence,
- last outcome/last seen.

Confidence should increase with repeated measured evidence and decrease or remain low when results conflict.

## CI self-healing

Self-healing is a separate reasoning problem from the original implementation plan.

### Repair flow

```text
verification failure
  -> collect failed checks/jobs/logs
  -> redact likely secrets
  -> load previous repair attempts + memory
  -> diagnose root cause
  -> reject low-confidence guessing
  -> generate minimal patch
  -> deterministic repair safety checks
  -> reject identical prior failed patch
  -> apply to existing RepoFinisher branch
  -> rerun verification
  -> mark repair verified or failed
  -> record operational memory
```

### Repair protections

A repair must not:

- delete files,
- modify tests to hide a product bug,
- modify GitHub workflows to evade checks,
- change CODEOWNERS/SECURITY.md to reduce control,
- alter lockfiles in the bounded repair path,
- change existing package `test`, `lint`, or `typecheck` scripts just to pass,
- expose credentials,
- repeat the same failed patch unchanged.

If the best remaining hypothesis is weak, stop rather than guessing.

## Multi-iteration completion

The intended architecture includes a higher-level completion session that continues after a successful individual run when measured completion/readiness is still below the configured target.

The desired loop is:

```text
current repo
  -> reason
  -> approved bounded implementation
  -> verify / repair
  -> rescore
  -> reached target? stop success
  -> no meaningful progress? stop blocked
  -> budget/iteration exhausted? stop bounded
  -> otherwise reason again from new HEAD
```

The schema for this behavior exists, but the active runtime controller remains a tracked implementation priority in `docs/PROJECT_STATE.md`.

Important guardrails:

- use fresh HEAD every iteration,
- do not reuse stale exact plans,
- stop after repeated no-progress,
- enforce maximum iterations/cost/risk,
- retain each iteration's audit/rollback evidence,
- do not merge automatically by implication.

## Finish Portfolio

Portfolio finishing must preserve per-repository isolation.

A portfolio orchestrator may schedule work, but each repository keeps its own:

- plan/base SHA,
- branch,
- PR,
- CI state,
- repair attempts,
- budget,
- outcomes,
- learning evidence.

A child failure should not corrupt successful siblings. Conversely, a successful sibling must not make the failed repo appear complete.

Finish Portfolio should eventually use the same self-healing and iterative-session behavior as direct runs.

## External LLM handoff

The external prompt feature should reuse the same assessment rather than invent a second planning system.

The generated prompt should contain:

- repository identity,
- assessed commit SHA,
- current completion/readiness,
- evidence-backed blockers,
- accepted root causes,
- risks/unknowns,
- ordered work,
- validation/Definition of Done,
- security/approval constraints,
- instruction to inspect current HEAD and re-assess if it moved.

Provider-specific versions should mainly adapt ergonomics. They should not change the substantive definition of complete.

## Learning evaluation

The system should periodically be evaluated on real repositories, not only unit tests.

Useful aggregate measures:

- percentage of runs that reach verified success,
- average completion delta,
- average readiness delta,
- percentage needing repair,
- repair success rate by attempt,
- stale-plan rate,
- no-progress rate,
- average time/cost to verified improvement,
- regression rate after generated changes,
- proportion of "successful" runs that actually reach product-level readiness targets,
- prompt-strategy performance by repository class.

The correct optimization target is not "produce more patches." It is "produce verified repository progress with low regression/risk and increasing completion efficiency."

## Auditability

Persist compact reasoning artifacts such as findings, hypotheses, critiques, specialist summaries, confidence, evidence references, and final decisions.

Do not depend on or expose hidden chain-of-thought. The product should be auditable through concise evidence and decision records.

## Definition of learning success

RepoFinisher is genuinely learning when, over enough measured runs:

- it stops repeating known failed patterns,
- it selects better plans for similar evidence,
- it needs fewer repair attempts for recurring failures,
- completion/readiness gains improve,
- regression rates fall,
- prompt-strategy promotion is supported by outcome data,
- the system can explain which measured evidence changed its recommendation.