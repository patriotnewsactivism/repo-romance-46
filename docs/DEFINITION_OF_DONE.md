# RepoFinisher Definition of Done

RepoFinisher must not equate "a patch was created" or "CI passed" with "the repository is finished."

This document defines the default evidence standard for declaring a target repository materially complete. Individual repositories may require additional product-specific acceptance criteria.

## Core rule

A repository is only complete when the intended product can be used, operated, deployed, and maintained with no known material blocker inside the agreed scope.

Completion must be based on current evidence from the assessed commit/deployment. Unknowns remain unknown until verified.

## Required completion dimensions

Assess each dimension as applicable.

### Product intent and core user journeys

- Product purpose is understood from repository and product evidence.
- Primary user journey works end-to-end.
- Critical actions do not terminate in placeholders, dead controls, mock-only behavior, or unhandled errors.
- Empty/loading/error/success states are intentional.
- Mobile and desktop behavior is usable when a web UI exists.

### Frontend and UX

- Navigation is functional and readable.
- Critical controls are visible and accessible.
- Responsive layouts do not hide required actions.
- Theme/contrast remains usable.
- Forms save, reload, validate, and report errors correctly.
- Broken images/placeholders do not damage core UI.

### API/backend

- Required routes exist and match frontend/client contracts.
- Authentication and authorization are enforced server-side.
- Input validation and meaningful error responses exist.
- Long-running work has an appropriate execution model and does not rely on a request lifetime it cannot satisfy.
- Retry/idempotency behavior is considered where duplicate execution is dangerous.

### Data and migrations

- Required schema exists through repository-tracked migrations.
- Migrations are safe for existing data and production ordering.
- RLS/authorization is correct for user-owned data.
- Service-role functions are least-privilege.
- No unresolved manual-schema drift is required to operate the product.

### Authentication and secrets

- Login/session behavior works where required.
- Secrets are server-side and never embedded in browser-visible variables/source.
- Credentials are stored using the approved secret-storage mechanism.
- Secret values are not returned in normal API responses or logs.

### Payments/commercial flows

When applicable:

- Checkout/subscription/payment state is connected to real backend behavior.
- Success, failure, cancellation, renewal, and entitlement states are handled.
- Test/live environment separation is explicit.
- Revenue/customer claims are not inferred from code presence alone.

### Tests and CI

- Relevant tests exist for critical behavior.
- Tests pass without weakening acceptance criteria.
- Typecheck/lint/build checks required by the repository pass.
- CI runs on the current implementation commit or PR.
- A missing test surface is treated as a readiness gap, not assumed correct.

### Deployment and runtime

- Production/release configuration is present and valid.
- Target deployment succeeds.
- Runtime health/smoke evidence is available.
- Frontend/API/auth/data seams work across actual production origins.
- Environment variables are documented and correctly scoped.

### Security

- No known committed secrets.
- Auth/RLS/permission boundaries are not bypassed.
- High-risk network probes defend against SSRF where relevant.
- Security-sensitive changes preserve least privilege.
- CI/self-healing does not mutate security controls merely to pass.

### Accessibility

For user-facing applications, verify at minimum:

- keyboard-accessible primary interactions,
- labels/names for critical controls,
- readable contrast,
- focus behavior for dialogs/menus,
- no major blocker identifiable from repository/UI evidence.

### Observability and operations

- Material failures are diagnosable through logs/events/traces where appropriate.
- Runbooks/environment docs exist for non-obvious production dependencies.
- Operator actions such as migrations, credential setup, and deployment are reproducible.

### Documentation

- README/setup instructions match current architecture.
- Required environment variables are documented without secret values.
- Deployment/operations instructions reflect the actual approved hosts.
- Known limitations are not hidden.

## RepoFinisher autonomous-run evidence

A RepoFinisher-generated completion run should not be treated as terminal success until, as applicable:

1. exact plan/base SHA were bound and approved,
2. changes were written to an isolated branch,
3. a draft PR exists,
4. CI/checks pass,
5. deployment/runtime verification passes or is explicitly unavailable,
6. completion/readiness is re-scored,
7. measured outcome telemetry is persisted,
8. unresolved material blockers are surfaced,
9. another bounded iteration is scheduled/available when targets are not met.

## Target thresholds

Default percentage targets are planning controls, not substitutes for evidence.

A high completion/readiness percentage cannot override a known critical blocker. Conversely, a repository should not be held below completion only because a non-applicable category lacks evidence.

## Stop conditions

A completion loop should stop and surface a blocker rather than guessing when:

- required access/credentials are unavailable,
- evidence is insufficient to make a safe change,
- the base repository moved and invalidated the plan,
- repeated attempts produce no measurable progress,
- a configured risk/cost/time limit is reached,
- required human/product decisions are genuinely ambiguous,
- the next action would require weakening tests/security/approval boundaries.

## External-LLM parity

The detailed external completion prompt must use this same Definition of Done. An external coding agent is not allowed to call the repository complete using a weaker standard than RepoFinisher itself.

## Updating this document

When a new product class exposes a recurring completion dimension not represented here, add it here and update RepoFinisher's assurance/planning logic where practical. Do not silently add a stricter or weaker private definition only inside one prompt.