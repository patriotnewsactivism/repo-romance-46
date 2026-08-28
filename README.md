# RepoFinisher

RepoFinisher is an autonomous repository-completion operating system. Its job is not merely to suggest changes or generate a patch. It assesses the current state of a repository, reasons about what remains unfinished, produces an exact bounded plan, executes approved work on an isolated branch, verifies the result, repairs eligible failures, measures the outcome, and feeds verified lessons back into future runs.

## Mission

RepoFinisher should help turn incomplete, abandoned, partially functioning, poorly deployed, or commercially underdeveloped repositories into finished, tested, secure, deployable products.

The product combines:

- repository completion and production-readiness scoring;
- investment/value and commercialization analysis;
- evidence-driven multi-stage reasoning;
- dynamic specialist agents;
- exact-plan approval and tamper-evident execution;
- draft pull-request generation;
- CI and deployment-preview verification;
- bounded self-healing CI repair;
- measured post-run learning and operational memory;
- portfolio-wide ranking, relationship/consolidation analysis, and finishing;
- continuous-repository change monitoring;
- security/product-readiness assurance; and
- detailed external-LLM completion handoffs for users who choose to finish a repository with another coding agent.

External-agent handoffs complement RepoFinisher. They do not replace its own autonomous finishing path.

## Production architecture

The supported production architecture is:

| Surface | Platform | Purpose |
| --- | --- | --- |
| Web frontend | Netlify | Vite/React SPA and `repofinisher.donmatthews.live` |
| Persistent API | Render | Express API, long-running reasoning, finishing, verification and repair work |
| Database/Auth/Vault | Supabase | Postgres, Auth, RLS, durable run state, learning memory and encrypted BYOK AI credentials |
| Source/CI/PRs | GitHub | Repository source, GitHub Actions, branches, draft PRs and target-repository operations |
| Observability | Sentry | Optional/recommended production error and trace telemetry |

**Vercel is not an approved deployment platform for RepoFinisher. Do not add Vercel deployment configuration or deploy this project to Vercel.** See [AGENTS.md](./AGENTS.md) and [docs/OPERATIONS.md](./docs/OPERATIONS.md).

## How a completion run works

1. Inspect the current repository and exact HEAD SHA.
2. Load repository-specific and cross-repository measured learning.
3. Diagnose root causes from evidence.
4. Run skeptical critique and relevant specialist reviews.
5. Produce the smallest ordered completion plan with explicit validation and stop conditions.
6. Bind the plan to its base SHA and plan hash.
7. Require approval unless the user explicitly selected a bounded higher-autonomy mode.
8. Apply changes on an isolated RepoFinisher branch and create a **draft** PR.
9. Observe GitHub checks and, when available, isolated deployment-preview evidence.
10. Use bounded evidence-driven self-healing for eligible failures. Never weaken tests or governance to make a run pass.
11. Re-score completion/readiness and persist measured outcome data.
12. Update operational memory and prompt-strategy experiment evidence from the measured result.

A green commit is evidence, not by itself proof that a repository is fully finished. Product completion must also consider the actual user flow, runtime/deployment behavior, security/data surfaces, and remaining accepted gaps.

## Repository layout

```text
artifacts/
  api-server/             Persistent Express API and autonomous execution engine
  repo-finisher/          Production React/Vite web application
  repo-finisher-mobile/   Mobile artifact/workstream
  mockup-sandbox/         Non-production mockup/sandbox artifact
lib/
  repo-os/                Shared completion/readiness/value domain logic
  ...                     Shared generated/workspace libraries
supabase/migrations/      Append-only production database migrations
scripts/                  Smoke checks and operational scripts
.github/workflows/        CI and production smoke workflows
docs/                     Architecture, operations and reasoning documentation
```

## Local development

RepoFinisher is a pnpm workspace. Use pnpm; the root package intentionally rejects npm/yarn installs.

Requirements:

- Node.js 20+ (GitHub CI currently uses Node 20; Netlify currently builds with Node 24)
- pnpm 9.15.9
- a Supabase project for authenticated/full-stack development

Install and validate:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Frontend development:

```bash
pnpm --filter @workspace/repo-finisher dev
```

API development:

```bash
pnpm --filter @workspace/api-server dev
```

Production seam smoke check:

```bash
FRONTEND_URL=https://repofinisher.donmatthews.live \
API_URL=https://repofinisher-api-live.onrender.com \
SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
pnpm test:smoke
```

## Configuration

Start with [.env.example](./.env.example). Keep frontend and backend configuration separate.

Browser-visible values may use the `VITE_` prefix. **Never prefix private credentials with `VITE_`** because Vite embeds those values into the browser bundle.

Key security rules:

- User AI BYOK credentials are stored in **Supabase Vault**. The browser receives only whether a key is configured, never the decrypted credential.
- GitHub connection tokens currently use the server-side secret-encryption layer and must never be exposed to the frontend.
- Platform provider credentials (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, etc.) belong only on the Render API.
- `SUPABASE_SERVICE_ROLE_KEY`, signing keys and other privileged secrets belong only on trusted server infrastructure.
- The Supabase publishable/anon key is a browser credential; RLS is the authorization boundary.

## AI providers

Supported providers are:

- Google Gemini
- OpenAI
- Anthropic
- OpenRouter

Users can save an exact provider/model combination and a BYOK key through Settings. BYOK credentials take precedence over platform credentials. Platform credentials are a server-side fallback and must not be committed to the repository.

## Safety invariants

These rules are architectural requirements, not prompt suggestions:

- never expose, commit or generate secrets;
- never silently auto-merge RepoFinisher-generated PRs;
- never weaken/delete tests, CI, security controls, CODEOWNERS, SECURITY.md, approval gates or acceptance criteria to get a green result;
- never execute an approved plan against a different base SHA;
- never claim verified revenue, customers, TAM, competition or market share without supporting external evidence;
- never describe operational memory/prompt adaptation as model-weight self-training;
- never edit an already-applied production migration to change history; add a forward migration;
- never treat a partially inspected/truncated repository as fully assessed;
- stop or re-plan when evidence is stale, confidence is too low, the base moved, budgets are exceeded, or repeated attempts show no measurable progress.

## Documentation index

- [AGENTS.md](./AGENTS.md) — authoritative rules for coding agents
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution, PR and validation workflow
- [SECURITY.md](./SECURITY.md) — vulnerability reporting and repository security rules
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — system architecture and boundaries
- [docs/OPERATIONS.md](./docs/OPERATIONS.md) — deployment, migrations, release and incident operations
- [docs/REASONING_AND_LEARNING.md](./docs/REASONING_AND_LEARNING.md) — reasoning, learning and experiment semantics
- [docs/CURRENT_STATUS.md](./docs/CURRENT_STATUS.md) — dated operational checkpoint and known follow-up work
- [docs/sentry-observability.md](./docs/sentry-observability.md) — Sentry setup/status

## License

See [LICENSE](./LICENSE).
