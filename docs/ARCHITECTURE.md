# RepoFinisher Architecture

## System boundary

RepoFinisher is split into a browser SPA, a persistent API/execution service, Supabase-backed durable state, and GitHub as both source control for RepoFinisher and the execution surface for target repositories.

```text
Browser
  |
  v
Netlify (React/Vite SPA)
  |
  | HTTPS + Supabase bearer token
  v
Render (Express API)
  |            |             |
  |            |             +--> AI providers (Google/OpenAI/Anthropic/OpenRouter)
  |            +----------------> GitHub API / Actions / branches / draft PRs
  +-----------------------------> Supabase Postgres/Auth/RLS/Vault

GitHub Actions ---> CI + provider-neutral production smoke checks
Sentry ---------> optional frontend/API error and trace telemetry
```

## Primary packages

### `artifacts/repo-finisher`

Production web application.

Responsibilities:

- authentication/session-aware UX;
- repository/portfolio analysis UI;
- settings/provider/model controls;
- run approval and progress UI;
- external-agent handoff prompt display/copy;
- observability hooks; and
- API requests to the persistent backend using `VITE_API_BASE_URL`.

The frontend must never receive privileged service credentials.

### `artifacts/api-server`

Persistent Express API and autonomous execution layer.

Responsibilities include:

- authenticated API surface;
- GitHub repository inspection;
- multi-stage reasoning orchestration;
- exact-plan preparation and hashing;
- execution against an approved base SHA;
- draft PR creation;
- CI/deployment verification;
- bounded CI repair;
- portfolio finishing;
- continuous-repository monitoring;
- product/security assurance;
- provider routing/model selection;
- external-agent completion handoffs; and
- post-run learning.

Long-running reasoning and repair work belongs here, not in short-lived frontend/serverless request handlers.

### `lib/repo-os`

Shared deterministic scoring/domain logic for completion, production readiness, value, remaining work and portfolio ranking.

Deterministic scoring should stay separate from generative reasoning whenever possible so results remain inspectable and testable.

### `supabase/migrations`

Append-only schema evolution for production Supabase.

Major durable concepts include:

- analyses and investment intelligence;
- completion runs/steps/events/approvals;
- portfolio completion runs/items;
- CI repair attempts;
- prompt-strategy experiments;
- operational learning memories;
- reasoning traces;
- portfolio relationships;
- product-readiness runs;
- continuous repository watches/events;
- async jobs; and
- AI BYOK Vault references.

## Authentication and authorization

The SPA authenticates with Supabase. Requests to the Render API carry the user's Supabase bearer token. The API verifies that identity before trusting `userId` and uses user-scoped Supabase clients/RLS for normal application access.

Privileged operations that must not be available to browser-authenticated clients use a server-side service-role client. Supabase Vault functions for AI credential read/write/delete are one example.

## Credential model

### AI BYOK

User-supplied AI provider keys are stored in Supabase Vault. `user_preferences` stores only an opaque Vault UUID. The browser sees only safe status metadata.

### Platform AI keys

Optional provider fallbacks are environment variables on the Render API:

- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`

Exact platform model defaults may be configured with `AI_MODEL` or provider-specific model variables.

### GitHub credentials

GitHub connection tokens currently use the application's sealed-secret mechanism and therefore depend on the server-side encryption key. If that key changes, old ciphertext may become unreadable; the code intentionally treats that as a disconnected credential rather than crashing authenticated routes.

## Completion engine

The completion engine is approval-bound and SHA-bound.

A prepared plan contains:

- target repo;
- default branch;
- exact base SHA;
- ordered next steps;
- bounded file changes;
- reasoning metadata when available; and
- a deterministic plan hash.

Execution re-checks that the current default-branch head still equals the approved base SHA. If not, the run becomes stale and must be re-planned.

## Reasoning engine

The reasoning path is evidence-first:

1. collect repository evidence;
2. load operational memory and existing adaptive-learning context;
3. select controlled prompt strategy;
4. diagnose root causes;
5. run skeptical critique;
6. invoke evidence-justified specialists;
7. synthesize an ordered plan with validation and stop conditions; and
8. pass that plan to the coding agent.

See [REASONING_AND_LEARNING.md](./REASONING_AND_LEARNING.md).

## Verification and repair

Verification combines available GitHub check runs/statuses with isolated deployment-preview evidence when one is discoverable.

A failed eligible verification may trigger bounded self-healing. Repair agents operate under stricter path/control protections than ordinary planning and must use fresh failure evidence. Repeating an identical failed patch is rejected.

## Portfolio layer

Portfolio intelligence adds system-level reasoning above individual repositories:

- ranking by completion/value/opportunity;
- confidence-adjusted valuation;
- full-portfolio vs deep-cohort analysis;
- relationship graph for duplicate/shared IP and product components;
- bounded Finish Portfolio orchestration; and
- persistent run/item progress.

Related repositories must not automatically be double-counted as independent commercial products.

## External-agent handoffs

A repository may produce a standalone completion handoff for another coding agent. The handoff is generated from the same current-state assessment used by RepoFinisher and should contain exact SHA, evidence, root causes, ordered work, validation and stop conditions.

This feature is an interoperability surface, not a replacement for the internal completion engine.

## Hosting policy

Production frontend: Netlify.

Production API: Render.

Vercel hosting is prohibited. Provider-specific runtime helpers that remain from prior architecture should be treated as migration debt and replaced with provider-neutral mechanisms rather than expanded.
