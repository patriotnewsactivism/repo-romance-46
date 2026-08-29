# External LLM Completion Handoff Contract

RepoFinisher may generate a detailed completion prompt for an external coding agent such as Codex, Claude Code, Gemini CLI, or a provider-neutral agent.

This feature is a portability/complementary workflow. It must not become a substitute for improving RepoFinisher's own autonomous completion engine.

## Purpose

The handoff should let an external agent start from RepoFinisher's current evidence and reasoning instead of receiving a generic instruction such as "finish this repo."

A useful handoff should answer:

- What product is this repository intended to be?
- What exact commit was assessed?
- How complete and production-ready is it now?
- What is verified, inferred, or unknown?
- What material blockers remain?
- What root causes/prerequisites were identified?
- What work should happen first and why?
- What security/approval/deployment constraints apply?
- What evidence is required before calling the repository complete?

## Required prompt contents

Every generated completion handoff should include, when available:

1. repository identifier and assessed HEAD SHA,
2. product intent/summary,
3. current completion/readiness assessment,
4. evidence-backed blockers/findings,
5. known unknowns and confidence limitations,
6. ordered implementation plan,
7. specialist findings/risks,
8. relevant operational memories without secret content,
9. existing deployment/CI/schema/auth/payment constraints,
10. validation plan and Definition of Done,
11. stop conditions,
12. explicit instruction to re-assess if the repository HEAD has changed.

## Safety requirements

The external prompt must preserve RepoFinisher's safety expectations:

- never expose or request secrets for repository content,
- do not weaken tests/CI/security controls to get a passing result,
- preserve existing working interfaces unless evidence supports changing them,
- use repository migrations for schema changes,
- validate auth/RLS/permissions where relevant,
- require actual deployment/runtime evidence when claiming production readiness,
- do not fabricate revenue, users, demand, market share, or competitive facts,
- do not declare completion solely because a build passes.

The prompt must not include decrypted BYOK credentials, GitHub tokens, service-role keys, signing secrets, or sensitive user data.

## Provider-specific variants

Provider-specific versions should only change execution ergonomics, not substance.

Examples:

- Codex: emphasize repository inspection, commands/tests, focused edits, and iterative verification.
- Claude Code: emphasize evidence, plan checkpoints, source inspection, and exact validation.
- Gemini CLI: emphasize repo/tool inspection, commands, implementation, and test/deploy validation.
- Neutral: avoid provider-specific command assumptions.

The underlying findings, constraints, and Definition of Done should remain equivalent.

## Iterative behavior

The external agent should be instructed to work iteratively:

```text
inspect current HEAD
-> validate RepoFinisher assessment
-> implement highest-priority root-cause fix
-> run relevant checks
-> inspect failures
-> correct implementation without weakening acceptance criteria
-> re-assess remaining product gaps
-> continue until Definition of Done or a documented stop condition
```

The prompt should explicitly discourage a one-patch-and-stop interpretation when material blockers remain.

## Definition of Done

External handoffs must reference or embed the substance of `docs/DEFINITION_OF_DONE.md`.

If the target application has product-specific acceptance criteria, include them in addition to the default standard.

## Assessment freshness

The assessed commit SHA is mandatory when known.

If the external agent observes a different HEAD:

- do not blindly execute stale file-level instructions,
- re-inspect changed areas,
- preserve still-valid requirements,
- re-plan where assumptions no longer hold.

## Output expectations for the external agent

The handoff should ask the external agent to report:

- changes made,
- files affected,
- tests/checks run and results,
- deployment/runtime verification,
- migrations applied/required,
- unresolved blockers,
- any deviation from the supplied plan and why,
- final evidence for each material Definition-of-Done dimension.

## RepoFinisher reintegration

Where practical, externally completed work should be re-ingested by RepoFinisher for re-analysis and scoring rather than accepted on narrative claims alone.

The ideal loop is:

```text
RepoFinisher assessment
-> external implementation (optional)
-> GitHub commit/PR
-> RepoFinisher re-analysis/verification
-> updated completion/readiness/value evidence
```

This preserves RepoFinisher's role as the system of record for completion intelligence even when implementation is delegated.