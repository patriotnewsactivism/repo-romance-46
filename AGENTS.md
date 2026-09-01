# AGENTS.md — RepoFinisher Operating Rules

This file is the canonical instruction set for coding agents, autonomous assistants, and external LLMs working in this repository.

Read this file, `README.md`, and `docs/PROJECT_STATE.md` before making changes. For architecture-sensitive work also read `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/CLOUD_RUN_MIGRATION.md`. For completion claims use `docs/DEFINITION_OF_DONE.md`. For incidents use `docs/INCIDENT_RESPONSE.md`.

## Mission

RepoFinisher must become exceptionally good at taking incomplete, abandoned, partially functioning, poorly deployed, or poorly designed repositories and turning them into finished, tested, secure, deployable, commercially useful applications.

Do not reduce the product to a demo, recommendation dashboard, or one-shot code generator. Preserve and improve its ability to:

- inspect repositories deeply;
- infer intended product behavior from current evidence;
- score completion, production readiness, opportunity, and value;
- reason about root causes and dependencies;
- create exact implementation plans;
- obtain the required approval;
- implement on isolated branches;
- open draft PRs;
- validate CI and runtime evidence;
- repair bounded failures without gaming acceptance criteria;
- re-score results;
- learn from measured outcomes;
- continue iterating when a repository is still materially unfinished;
- generate detailed external-LLM completion prompts as a complementary handoff.

## Canonical production architecture

Current production source-of-truth topology is:

- Google Cloud Run `repofinisher-web` — frontend SPA.
- Google Cloud Run `repofinisher-api` — API/control plane.
- Google Cloud Run Job `repofinisher-completion-session` — long-running completion workers.
- Supabase — authentication, database, RLS, Vault, durable execution state.
- GitHub + GitHub Actions — source, branches, draft PRs, repository evidence, CI/build/test evidence, and deployment automation.
- Google Artifact Registry — immutable container images.
- Google Secret Manager — backend compute-host secrets.
- Cloudflare — canonical custom-domain DNS used by the deployment workflow.
- Sentry + Cloud Run/Cloud Logging — observability when configured.

The canonical product domain is `https://portfolio.donmatthews.live`.

**Never deploy RepoFinisher to Vercel. Never add Vercel hosting configuration back to the repository.** Preserve the CI guard that rejects Vercel hosting artifacts.

`netlify.toml` and the former Render service are legacy migration/rollback artifacts, not current production targets. Do not route production back to them merely because they exist. Any rollback must be deliberate, evidence-backed, and recorded in `docs/PROJECT_STATE.md`.

## Security boundaries

Never commit secrets.

Never put these in frontend code or `VITE_*` variables:

- Supabase trusted backend/service-role keys;
- GitHub access tokens;
- AI provider API keys;
- `PLAN_SIGNING_SECRET`;
- `SECRET_ENCRYPTION_KEY`;
- Sentry auth tokens;
- Google service-account private keys;
- private keys or credential JSON.

`VITE_*` values are browser-visible by design.

AI BYOK credentials must use the trusted server-side Supabase Vault path. Normal browser/authenticated Supabase clients must never receive decrypted Vault secrets. Store/read/delete Vault RPCs remain backend-only.

Stored GitHub credentials currently use server-side sealing. During infrastructure/key rotations, preserve the existing encryption-key value or perform an explicit credential migration. An unreadable historical envelope should not crash unrelated authenticated features.

Cloud Run backend secrets must come from Google Secret Manager. GitHub Actions must authenticate to Google Cloud through OIDC/Workload Identity Federation rather than a long-lived service-account JSON key.

Do not weaken RLS, auth checks, CORS, security middleware, permission boundaries, rate limits, secret scanning, approval gates, or least-privilege IAM for convenience.

## Repository-write contract

Normal generated repository modifications must maintain a hard rollback/audit boundary:

1. Resolve the exact target repository and base SHA.
2. Gather current evidence and relevant measured memory.
3. Reason about blockers/root causes.
4. Generate an exact bounded implementation plan.
5. Bind the plan to the base commit/hash.
6. Require exact-plan approval unless the user explicitly selected a product-defined bounded higher-autonomy mode.
7. Re-check that the base is still current before writing.
8. Write to an isolated branch.
9. Open a draft PR.
10. Validate checks and applicable deployment/runtime evidence.
11. Perform only bounded, evidence-driven repair.
12. Re-score completion/readiness and persist outcome telemetry.
13. Continue another bounded iteration only when policy, budgets, risk, no-progress rules, and execution limits permit it.

Automatic merge is not authorized by default.

Do not silently elevate permissions, autonomy, concurrency, budget, or merge authority.

## Cloud Run worker contract

Long-running finish-until-target work belongs on the Cloud Run Job worker plane rather than depending on an HTTP request lifetime.

The API may dispatch only the minimum per-execution identifiers required to resume durable state. Repository credentials, provider keys, approval state, branch state, CI state, and progress belong in trusted durable storage—not job environment overrides.

Worker retries/re-dispatches must reuse durable session state and lease/heartbeat protections. They must not replay completed branch writes merely because a Cloud Run execution retried.

The API may retain an in-process fallback for local development or controlled recovery, but production heavy work should use the configured worker plane.

## Self-healing rules

Self-healing exists to fix implementation defects, not to game verification.

A repair agent may change source or safe configuration when current failure evidence supports the diagnosed root cause. It must not:

- delete, weaken, skip, mute, or rewrite tests to obtain green CI;
- change test/lint/typecheck scripts merely to pass;
- modify CI/security governance merely to pass;
- remove required checks;
- reduce CODEOWNERS/SECURITY.md controls;
- expose or copy secrets;
- repeat an identical failed repair unchanged;
- continue guessing when root-cause confidence is too low.

After a failed repair, gather fresh logs/current branch evidence and re-diagnose. If no evidence-backed safe repair remains, stop and surface the blocker.

Direct repository completion, Finish Portfolio, and iterative completion sessions must share these same safety rules. Portfolio-scale execution is never a weaker-policy path.

## Reasoning quality

Prefer evidence-driven multi-stage reasoning over one undifferentiated prompt.

For meaningful completion work:

- collect current repository evidence;
- identify multiple plausible root-cause hypotheses when useful;
- distinguish verified facts, inferences, estimates, and unknowns;
- run a skeptical/verification critic;
- select specialists only when repository evidence justifies them;
- order prerequisites before dependent work;
- tie each material action to a validation path;
- identify regression risks and stop conditions;
- lower confidence when evidence is incomplete rather than inventing facts.

Do not fabricate repository files, APIs, deployment state, revenue, users, TAM, customer demand, competition, or market share.

## Learning contract

RepoFinisher's learning is measured operational learning. Do not describe it as autonomous model-weight retraining.

Persist and use, when available:

- outcome score;
- completion delta;
- readiness delta;
- failure mode;
- repair diagnosis;
- prompt strategy/version;
- specialists used;
- evidence confidence;
- deployment/CI outcome;
- recurring cross-repo patterns.

A failure must reduce confidence in repeating the same strategy unchanged. A success should become reusable guidance only when supported by measured evidence.

Prompt experimentation may change planning/reasoning technique only. It may not mutate immutable security, approval, permission, rollback, merge, or validation policy.

## Completion means more than green CI

Do not declare a target repository finished merely because a generated PR passes CI.

Completion should consider, as applicable:

- core user journeys;
- frontend UX and responsive behavior;
- API correctness;
- authentication/authorization;
- schema and migrations;
- payments/subscriptions;
- deployment configuration;
- production runtime health;
- accessibility;
- security controls;
- automated tests;
- error handling and observability;
- documentation/operator setup;
- outstanding blockers from prior analysis.

`docs/DEFINITION_OF_DONE.md` is the canonical default evidence standard. Do not lower it privately inside a prompt/scoring rule to make a run look complete.

After a successful run, re-score the repository. If it remains materially below configured completion/readiness targets or has a known material blocker, another bounded iteration may be required.

## External LLM completion prompts

The external completion prompt complements RepoFinisher; it does not replace it.

Generated handoffs should include:

- assessed repository and immutable HEAD/base SHA;
- current completion/readiness state;
- evidence-backed blockers/root causes;
- ordered remaining work;
- specialist concerns;
- validation requirements;
- security/approval boundaries;
- Definition of Done;
- instruction to re-assess if repository HEAD moved.

Provider-specific formatting should remain thin. Codex, Claude Code, Gemini CLI, or another capable external coding agent should receive the same substantive assessment and completion contract.

See `docs/EXTERNAL_LLM_HANDOFFS.md`.

## Database changes

All production schema changes belong in `supabase/migrations/`.

Migrations must be forward-only, deterministic, safe for existing data, explicit about destructive behavior, RLS-aware, least-privilege, and reviewable without hidden manual steps.

Never expose service-role-only Vault functions to `anon` or normal authenticated browser roles.

Do not hardcode generated IDs into data migrations. Do not call a migration-dependent feature production-ready until the migration has been applied and its schema/policies/functions have been verified.

## UI rules

The production UI must remain usable on mobile and desktop.

Preserve the hardened theme/header behavior. If touching global/theme/header CSS, verify:

- header text/icons remain visible;
- mobile hamburger remains available through the intended breakpoint;
- menus have opaque/readable backgrounds;
- headings/body text retain sufficient contrast;
- broken avatars/images do not damage header layout;
- dark/light states behave intentionally.

For Settings changes, verify save/reload/error states, provider/model persistence, BYOK handling, and that frontend requests reach the Cloud Run API rather than the static web host.

## Development workflow

Use `pnpm` only.

Before opening or merging a PR, run or obtain CI evidence for:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The root build includes typechecking and workspace production builds.

Do not bypass red CI. Diagnose and fix it.

Prefer focused branches/PRs. Avoid broad unrelated refactors bundled into production-critical work.

Update documentation in the same PR whenever architecture, environment variables, deployment targets, security storage, approval policy, completion criteria, or operating behavior changes.

## Release workflow

A normal production-impacting change should have:

1. focused branch;
2. reviewed diff;
3. green required GitHub CI;
4. required Supabase migration applied and verified;
5. immutable Cloud Run image(s) built from the intended commit;
6. Cloud Run API/Job/frontend deployment healthy when affected;
7. runtime environment contract audited;
8. custom-domain/DNS state verified when affected;
9. production smoke and relevant authenticated user flow verified;
10. rollback path understood.

Do not switch DNS before the replacement target is healthy.

Use `docs/RELEASE-CHECKLIST.md`. `merged`, `deployed`, `runtime verified`, and `user-flow verified` are different states.

## Incident response

Use `docs/INCIDENT_RESPONSE.md` when production is unavailable, serving stale code, failing authentication/API seams, exposing a security concern, or producing unsafe/unreliable autonomous completion behavior.

Preserve evidence before changing infrastructure. Prefer a known-good Cloud Run revision or explicitly verified rollback target over speculative host changes. Never use Vercel as an emergency workaround.

## Current status discipline

`docs/PROJECT_STATE.md` is intentionally time-sensitive. Read it before infrastructure work and update it when a rollout state changes.

Do not infer production success from source code alone. A merged Cloud Run workflow change is not proof that the deployment, domain mapping, DNS, authenticated flows, or a real completion-session Job succeeded.

## Documentation discipline

Canonical documents:

- `README.md` — product/repository overview;
- `AGENTS.md` — this file; agent operating contract;
- `SECURITY.md` — security policy;
- `CONTRIBUTING.md` — contribution workflow;
- `docs/ARCHITECTURE.md` — stable system design;
- `docs/OPERATIONS.md` — production operations;
- `docs/CLOUD_RUN_MIGRATION.md` — Cloud Run deployment/cutover and rollback contract;
- `docs/PROJECT_STATE.md` — current checkpoint;
- `docs/DEFINITION_OF_DONE.md` — completion evidence standard;
- `docs/REASONING_AND_LEARNING.md` — reasoning/learning behavior;
- `docs/EXTERNAL_LLM_HANDOFFS.md` — external-agent handoff contract;
- `docs/RELEASE-CHECKLIST.md` — release gates;
- `docs/INCIDENT_RESPONSE.md` — incident handling;
- `docs/DECISIONS.md` — durable decisions.

Model-specific instruction files (`CLAUDE.md`, `GEMINI.md`, `QWEN.md`, Copilot instructions) must defer to this file rather than maintaining competing rules.

When code/workflows and documentation conflict, inspect current `main`, correct the discrepancy, and update the canonical docs in one PR. Do not preserve inaccurate text simply because it is older.