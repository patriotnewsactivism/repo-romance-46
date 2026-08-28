# RepoFinisher Definition of Done

This document defines what "done" means for RepoFinisher itself and for repositories RepoFinisher attempts to complete.

Green CI is necessary evidence, but it is not sufficient proof that a product is finished.

## 1. Evidence before conclusion

A repository may be called complete only when the claim is supported by current evidence from the assessed commit/deployment. Evidence should distinguish:

- verified facts,
- reasoned inferences,
- unknown or untested areas.

If the repository HEAD or deployment changes after assessment, stale evidence must not be treated as current.

## 2. Product intent and core journeys

RepoFinisher must identify the product's intended primary users and core journeys from repository evidence, documentation, UI/API structure, configuration, and prior analysis.

For each material core journey, completion should verify as applicable:

- the user can enter the journey,
- required authentication/authorization works,
- required data can be created/read/updated safely,
- external integrations are configured or fail clearly,
- errors are handled without corrupting state,
- the journey reaches its intended successful end state,
- mobile/desktop behavior is usable when a web UI exists.

A product with an unverified or broken primary journey is not fully complete even if unit tests pass.

## 3. Code and repository quality

Applicable gates include:

- install succeeds from a clean checkout,
- typecheck succeeds,
- build succeeds,
- automated tests pass,
- lint/static analysis passes when configured,
- no known critical source/configuration blocker remains,
- required environment variables are documented,
- no credentials are committed,
- generated changes preserve existing working interfaces unless evidence justifies a breaking change.

## 4. Security and authorization

Where applicable, verify:

- authentication works,
- authorization is enforced server-side,
- tenant/user data boundaries are preserved,
- database RLS/policies are appropriate,
- service-role credentials remain backend-only,
- secrets are stored in approved secret storage,
- repository write authority remains bounded,
- sensitive logs/errors are redacted,
- SSRF/network probes are constrained,
- dependency/security checks have no unresolved release-blocking result.

Never lower a security or acceptance boundary simply to increase a completion score.

## 5. Database and migration readiness

If the product has schema/data changes:

- migrations are committed to source control,
- production ordering is understood,
- migrations are safe for existing data,
- RLS/grants/functions are reviewed,
- disposable/staging validation is used where practical,
- irreversible/destructive steps are explicit,
- production migration status is verified before calling the dependent feature live.

## 6. Deployment and runtime evidence

For deployable products, verify the real target environment rather than assuming a successful build equals a successful deployment.

Applicable evidence includes:

- deployment completed successfully,
- health endpoint/smoke probe succeeds,
- expected domain resolves over HTTPS,
- frontend reaches the intended API,
- API reaches required data/services,
- no obvious production 5xx/runtime failure is present,
- environment/configuration matches the documented architecture.

For RepoFinisher itself, approved production architecture is Netlify frontend + Render API + Supabase + GitHub. Vercel is not an approved target.

## 7. UI/UX/accessibility

For user-facing applications, verify as applicable:

- usable responsive layout,
- readable contrast,
- navigation/menu access,
- loading/empty/error states,
- form validation and save/reload behavior,
- keyboard/focus behavior for key flows,
- accessible labels/semantics on critical interactions,
- no broken images or invisible controls blocking primary journeys.

## 8. Payments and high-value integrations

If payments, subscriptions, email, OAuth, media streaming, AI providers, or other material integrations exist, completion requires evidence that the actual integration path works or is intentionally disabled with clear setup instructions.

Do not mark a provider/integration complete merely because its name appears in the UI.

## 9. Observability and operability

Production-capable applications should have enough operational evidence to diagnose failures. Depending on scope this can include:

- structured logs,
- error reporting,
- health checks,
- deployment logs,
- run/audit events,
- documented rollback/recovery steps.

RepoFinisher autonomous runs must persist enough evidence to reconstruct plan, approval, branch/PR, verification, repairs, and measured outcome without exposing private chain-of-thought.

## 10. Documentation

The repository must contain enough documentation for a competent maintainer or external coding agent to continue from the current state without relying on chat history.

At minimum, material changes should keep current:

- setup/run instructions,
- environment variables,
- deployment architecture,
- migration requirements,
- security constraints,
- known blockers/current state.

## 11. RepoFinisher autonomous-run completion

For RepoFinisher to mark one of its own completion runs successful:

1. Current repository evidence was gathered.
2. Reasoning identified the root blockers and ordered prerequisites.
3. The exact plan was bound to the assessed base SHA.
4. Required approval/autonomy acknowledgement was recorded.
5. Changes were isolated on a branch/draft PR.
6. CI/deployment/runtime evidence was collected.
7. Bounded self-healing, if needed, fixed implementation rather than acceptance criteria.
8. Completion/readiness was re-scored after the change.
9. Outcome telemetry and reusable learning were recorded.
10. No unresolved release-blocking condition remains hidden.

## 12. Iterative completion rule

A successful first patch is not automatically the end of the job.

After verification, compare measured completion/readiness against the configured target. If the repository remains materially unfinished, RepoFinisher should perform another bounded evidence/reasoning iteration unless a stop condition applies.

Valid stop conditions include:

- target completion/readiness reached,
- evidence is insufficient and further writes would be guessing,
- no-progress threshold reached,
- explicit user cancellation,
- time/cost/risk budget exhausted,
- required external credential/approval/infrastructure is unavailable,
- a safety/security boundary would need to be weakened to continue.

The runtime finish-until-target controller is tracked as incomplete until current source actually executes this loop end to end.

## 13. External LLM handoff Definition of Done

A generated external-agent completion prompt should carry this same substantive standard. It must not become a shortcut that lowers RepoFinisher's own standards.

The prompt should require the external agent to:

- verify the assessed SHA/current state,
- re-diagnose if the repository moved,
- resolve root causes rather than symptoms,
- iterate through remaining blockers,
- run real tests/build/CI,
- verify applicable auth/data/payment/security/integration flows,
- verify the deployed product when relevant,
- report unresolved blockers explicitly,
- stop rather than fabricate success.

## 14. Completion reporting

Every completion claim should say what was actually verified.

Preferred status language:

- **Verified complete** — applicable Definition of Done gates have evidence and no material blocker remains.
- **Production-ready with known limitations** — release gates pass but documented non-blocking limitations remain.
- **Partially complete** — meaningful improvement landed, but material gates remain unresolved.
- **Blocked** — progress requires missing evidence, credential, approval, infrastructure, or a decision.

Never convert an unknown into a passing result merely to raise a percentage.