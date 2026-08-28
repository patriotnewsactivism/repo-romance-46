# Reasoning and Learning

RepoFinisher's learning system is operational, evidence-driven adaptation. It is not model-weight training.

## Goals

The reasoning/learning layer should improve three things over time:

1. diagnosis quality — identify the actual blocker rather than patching symptoms;
2. planning quality — order work so prerequisites, risk and verification are handled correctly; and
3. repair quality — avoid repeating failed approaches and prefer strategies supported by measured outcomes.

## Reasoning pipeline

For a non-trivial repository completion plan, the preferred pipeline is:

1. **Evidence collection** — inspect repository metadata, exact HEAD SHA, tree signals and selected source/config/test files.
2. **Historical context** — load repository-specific operational memory, cross-repository memory and existing measured run outcomes.
3. **Strategy selection** — select an incumbent/challenger prompt strategy through the controlled experiment system.
4. **Evidence analyst** — produce explicit findings/root-cause hypotheses and unknowns.
5. **Skeptical critic** — reject unsupported findings, look for missing evidence and enumerate regression risk.
6. **Specialists** — invoke only roles justified by repository evidence (for example database, auth/security, frontend, deployment, payments, accessibility).
7. **Principal planner** — synthesize the smallest ordered plan likely to pass real validation, including risks and stop conditions.
8. **Coding agent** — generate bounded file changes tied to accepted reasoning.
9. **Verification** — observe real CI/commit/runtime evidence.
10. **Outcome measurement** — re-score completion/readiness where possible and persist the measured result.

## Operational memory

Durable operational memory is stored separately from model prompts.

A useful memory records:

- repository or cross-repository scope;
- category;
- observation;
- recommendation;
- sample count;
- successes/failures;
- measured average outcome score where available;
- measured completion/readiness deltas where available;
- confidence; and
- bounded supporting evidence.

High-confidence memory may influence future planning. It must never override immutable safety policy.

## Prompt strategy experiments

RepoFinisher supports controlled prompt evolution. Prompt strategy experimentation changes planning/reasoning guidance, not authorization or security policy.

The intended experiment design uses:

- an incumbent strategy;
- at most one challenger at a time;
- bounded challenger traffic;
- minimum scored samples per arm;
- a practical outcome-lift threshold;
- a statistical confidence gate;
- early rejection for meaningful completion/outcome regression; and
- promotion history retained for auditability.

A challenger must not be promoted simply because it had one good run.

## Specialist selection

Specialist agents should be selected from evidence, not spawned indiscriminately.

Examples of signals:

- Supabase/migrations/RLS -> database and/or security specialists;
- OAuth/session/permissions -> security/auth specialist;
- React/mobile/layout/accessibility -> frontend/accessibility specialist;
- deployment/worker/queue/container -> deployment/operations specialist;
- Stripe/billing/subscription -> payments/growth specialist.

More agents are not inherently better. Unnecessary specialists add cost, latency and noise.

## Self-healing learning loop

A failed verification is new evidence.

Repair should:

1. collect the latest failing check/log evidence;
2. retrieve prior relevant repair/failure memories;
3. inspect prior attempts for the same run;
4. diagnose the root cause before generating a patch;
5. refuse low-confidence guessing when evidence is insufficient;
6. reject an identical previously failed repair;
7. apply the smallest safe patch;
8. run verification again; and
9. update memory when the repair is verified or fails.

A repair that gets CI green by weakening tests or acceptance criteria is a failure, not learning.

## Measured outcomes

Post-run evaluation can use:

- final run status;
- completion delta;
- production-readiness delta;
- commercialization/finish-first score changes;
- remaining-work delta;
- present-value estimate change;
- duration;
- number of changed files; and
- whether the new head was actually verified.

Missing measurements must remain missing. Do not substitute zero for an unknown metric when that would bias learning.

## Reasoning traces

RepoFinisher persists compact auditable reasoning artifacts such as:

- evidence used;
- hypotheses/findings;
- critique;
- selected specialists;
- prompt strategy/version;
- decision/plan summary;
- confidence; and
- errors/status.

These are operational decision records. They are not intended to expose private hidden chain-of-thought transcripts.

## External-agent completion handoffs

The external prompt generator should reuse the assessed state rather than generate a generic prompt.

A good handoff contains:

- repository and assessed SHA;
- current completion/readiness assessment;
- known working behavior;
- blockers and root causes;
- ordered remaining work;
- risks and unknowns;
- specialist considerations;
- required tests/build/runtime verification;
- deployment/database/auth/payment checks where relevant;
- explicit stop/re-diagnose conditions; and
- a Definition of Done.

The handoff must tell the external agent to verify the current SHA and re-diagnose if the repository changed after assessment.

## Non-negotiable distinction

RepoFinisher may learn **which strategies work better from measured outcomes**. It must never claim that application-side memory or prompt experiments retrained the underlying provider model weights.
