# External LLM Completion Handoffs

RepoFinisher can generate a detailed current-state completion prompt for an external coding agent. This is a **complementary handoff path**, not a replacement for RepoFinisher's own autonomous finishing engine.

The purpose of the handoff is to let a user take RepoFinisher's evidence, reasoning, remaining-work analysis, and Definition of Done into another capable coding environment without throwing away the work already performed by RepoFinisher.

## Product contract

For each repository, the generated handoff should be derived from the same current-state assessment used by RepoFinisher itself. It should not be a generic prompt such as "finish this repository."

A handoff should include, when available:

- repository owner/name,
- assessed default branch,
- assessed HEAD SHA,
- assessment timestamp/version,
- repository/product intent inferred from evidence,
- current completion and production-readiness state,
- evidence confidence and known unknowns,
- accepted root-cause findings,
- rejected/low-confidence hypotheses where useful,
- ordered remaining work,
- prerequisite relationships,
- specialist concerns,
- security/data/auth/payment/deployment risks when present,
- required tests and validation evidence,
- deployment/runtime verification expectations,
- explicit stop/re-diagnosis conditions,
- Definition of Done.

The handoff must clearly state that the assessment is bound to a specific repository state. If the current repository HEAD no longer matches the assessed SHA, the external agent must inspect the delta and re-diagnose before applying the old plan.

## Provider-neutral core

The substantive task must remain provider-neutral.

Provider-specific variants such as Codex, Claude Code, Gemini CLI, or another agent may adapt formatting, command conventions, or tool-use phrasing, but they must not silently change:

- repository evidence,
- security boundaries,
- approval constraints,
- scope/risk limits,
- validation requirements,
- Definition of Done.

Do not create separate strategic truth for each model provider.

## Required external-agent behavior

The generated prompt should tell the external agent to:

1. Read the repository before writing code.
2. Verify the current HEAD against the assessed SHA.
3. Re-diagnose material drift rather than blindly applying stale instructions.
4. Preserve working behavior and public interfaces unless evidence shows they are the blocker.
5. Fix root causes rather than symptoms.
6. Work through prerequisites before dependent polish/features.
7. Keep changes bounded and reviewable.
8. Run the repository's actual tests, typecheck, lint/build, and CI-equivalent checks where available.
9. Inspect real failures and continue iterating within the authorized scope rather than stopping after one patch.
10. Validate database migrations safely before production use.
11. Validate auth/authorization, secrets, payments, privileged flows, and data boundaries when relevant.
12. Validate the deployed/runtime product when a deployment surface exists.
13. Never weaken tests, security controls, CI acceptance criteria, or permissions merely to make a result green.
14. Never invent secrets, production credentials, customers, revenue, market data, or repository APIs.
15. Report unresolved blockers explicitly instead of claiming completion.

## Definition of Done

A strong handoff should define completion in evidence terms, not activity terms.

Depending on the repository, completion may require:

- core user journey works end to end,
- no known critical/high-confidence blockers remain,
- tests pass,
- typecheck/build pass,
- CI passes,
- auth and authorization boundaries are verified,
- database migrations are safe and applied where required,
- payment/subscription flows are verified where present,
- deployment configuration is valid,
- deployed product responds correctly,
- mobile/responsive/accessibility concerns are addressed where applicable,
- security-sensitive configuration is not exposed,
- documentation/operator setup is current,
- no known regression is being hidden by weaker acceptance criteria.

The external agent should return a final handoff/report describing what changed, what was verified, and what remains unresolved.

## Relationship to RepoFinisher autonomy

Generating an external prompt must never disable or degrade RepoFinisher's internal completion capability.

The internal product should still be able to:

- reason about the repository,
- create an exact plan,
- obtain the required approval,
- implement on an isolated branch,
- create a draft PR,
- verify CI/deployment evidence,
- self-heal bounded failures,
- re-score outcomes,
- learn from the result,
- continue with another bounded iteration when appropriate.

The external handoff is an additional delivery channel for the same high-quality assessment.

## Persisted handoff metadata

When a handoff is persisted, prefer recording safe metadata such as:

- repository,
- analysis ID,
- reasoning trace ID,
- assessed SHA,
- provider target,
- generated timestamp,
- assessment version,
- prompt hash/version where implemented.

Do not persist decrypted provider credentials or unrelated secrets in prompt artifacts.

## Quality review checklist

Before treating an external prompt as useful, verify:

- it names the exact repository and assessed SHA,
- it contains current evidence rather than generic best practices only,
- its work is ordered,
- it distinguishes facts/inferences/unknowns,
- it includes validation and stop conditions,
- it does not expose credentials,
- it does not authorize test/security weakening,
- it makes clear that a stale repository requires re-assessment,
- it complements rather than replaces RepoFinisher's own completion path.

## Maintenance

If the reasoning schema, specialist system, completion contract, validation model, or security policy changes, update the handoff generator and this document in the same pull request.
