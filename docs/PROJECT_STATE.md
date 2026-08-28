# RepoFinisher Project State

**Snapshot date:** 2026-08-28

This file is intentionally time-sensitive. Update it whenever production hosting, core completion behavior, security storage, or major implementation priorities change.

Do not use this file as a substitute for inspecting the current code/deployments. It is a checkpoint and priority register.

## Canonical source

Repository:

```text
patriotnewsactivism/repo-romance-46
```

Default branch:

```text
main
```

Baseline `main` at the start of this documentation pass:

```text
01ca24bf9b12b97b5c216cd1d33136a6aa8f737f
security: move AI BYOK credentials into Supabase Vault
```

## Production architecture

Approved architecture:

- Netlify frontend
- Render persistent API
- Supabase auth/database/RLS/Vault
- GitHub source/CI/PRs
- Sentry when configured

Vercel is not an approved deployment target and must not be used again for RepoFinisher.

## Confirmed backend status

The canonical persistent API endpoint is:

```text
https://repofinisher-api-live.onrender.com
```

The Vault-backed BYOK merge at `01ca24bf...` was confirmed live on Render during the implementation session that preceded this documentation pass.

Supabase was also verified to have:

- service-role access to RepoFinisher Vault store/read/delete RPCs,
- at least one Vault-backed AI credential reference,
- a readable Vault reference through the service-role path,
- zero remaining legacy plaintext AI-key rows at that checkpoint.

## Frontend/Netlify status requiring verification

A Netlify project named `repofinisher` exists.

During this documentation pass the Netlify project reader reported:

```text
project: repofinisher
project id: 2a0328fa-7111-4054-86d0-0dba8f3b38c7
reported primarySiteUrl: http://repofinish.donmatthews.live
reported deploy state: current, with no detailed current deploy payload
```

The intended canonical product domain is:

```text
https://repofinisher.donmatthews.live
```

The `repofinish` vs `repofinisher` hostname mismatch must be treated as an unresolved infrastructure discrepancy until directly verified and corrected. Do not claim the frontend cutover is complete solely because the Netlify project exists.

Before closing the frontend migration:

1. Confirm current `main` is actually deployed on Netlify.
2. Confirm the production build contains the current Settings/BYOK fixes.
3. Confirm `VITE_API_BASE_URL` targets the Render API.
4. Confirm Supabase browser variables are present.
5. Confirm the canonical custom domain is exactly `repofinisher.donmatthews.live` over HTTPS.
6. Run production smoke.
7. Verify authenticated Settings save/test/remove flows in the browser.
8. Verify mobile header/theme contrast on the actual Netlify deployment.

## AI provider/settings status

Current source supports:

- Google
- OpenAI
- Anthropic
- OpenRouter

User preferences support an explicit provider and model.

User-supplied AI keys are now intended to be stored in Supabase Vault. The server retrieves them through service-role-only RPCs; the browser should receive only configuration/status metadata.

Remaining acceptance test:

- verify an authenticated production user can save, reload, test, switch, and remove each supported provider/model from the Netlify Settings UI without exposing the key.

## Reasoning and learning state

Implemented foundation includes:

- multi-stage repository reasoning,
- evidence analyst,
- skeptical critic,
- dynamically selected specialists,
- principal-plan synthesis,
- durable operational memories,
- repo-local and cross-repo learning,
- outcome scoring,
- prompt strategy experiments,
- reasoning traces/audit data,
- reasoned CI repair,
- external LLM completion prompts,
- continuous repository event reasoning,
- portfolio relationship analysis,
- assurance/readiness runs.

Learning is measured operational memory, not autonomous model-weight retraining.

## High-priority incomplete integration work

### 1. Multi-iteration finish-until-target controller

The database contains `repo_completion_sessions` schema for multi-iteration completion objectives, but current code search shows this table referenced only by migrations/hardening SQL, not by an active runtime controller.

That means the intended loop is not yet complete:

```text
reason -> implement -> verify -> rescore
   -> still below completion/readiness target?
   -> reason again with fresh evidence
   -> next bounded iteration
```

This is a critical gap because a green first PR is not equivalent to a fully completed repository.

### 2. Finish Portfolio self-healing parity

The direct per-repository run path contains bounded CI self-healing integration. Current source search shows `portfolio-finisher.ts` does not call `tryScheduleCiRepair`.

Finish Portfolio therefore still needs explicit parity so a child repository can use the same evidence-driven bounded repair behavior before the portfolio orchestrator treats it as terminally failed.

### 3. Portfolio completion-session orchestration

Once the iterative controller exists, Finish Portfolio should coordinate per-repo sessions without collapsing rollback/failure boundaries. Each repository must retain its own:

- plan hash,
- branch,
- PR,
- CI state,
- repair attempts,
- budget,
- outcome telemetry.

### 4. Product-flow verification depth

The assurance system can inspect repository, CI, deployment, and live-surface evidence, but application-specific authenticated browser journeys still need stronger explicit definitions for products involving login, payments, privileged operations, or complex state.

RepoFinisher should eventually derive or request a product-specific acceptance suite and treat those flows as part of the Definition of Done.

### 5. Residual Vercel runtime compatibility dependency

`artifacts/api-server/package.json` still lists `@vercel/functions`, and CI repair code historically used its `waitUntil` helper.

This does not authorize Vercel hosting. It is residual technical debt. Replace it with a provider-neutral lifecycle/background-job mechanism when safe, then remove the dependency.

### 6. Render capacity

Long-running reasoning and portfolio workloads should not rely indefinitely on a severely constrained/free compute tier. Verify the canonical API service plan and upgrade based on observed cold starts, CPU/memory, concurrency, and response latency.

Do not document an upgrade as completed until the actual service plan is verified.

## Completed major foundations

The following substantial capabilities are in `main` as of this snapshot:

- Repo Investment Intelligence and adaptive finishing
- measured post-run rescoring
- final synthesis hang fix
- full portfolio value and one-click finishing foundations
- 500-repo analysis limit migration
- Finish Portfolio orchestration foundation
- bounded self-healing CI
- tiered portfolio intelligence
- mobile/dark-theme contrast hardening
- deployment sandbox verification
- confidence-adjusted portfolio valuation
- controlled prompt evolution and specialist-agent foundation
- deeper Reasoning & Learning OS schema and APIs
- portfolio consolidation graph
- security/product assurance
- continuous repository watch/event reasoning
- external LLM completion handoffs
- dedicated AI provider/model Settings path including OpenRouter
- Supabase Vault-backed AI BYOK storage
- Netlify configuration and Render persistent API migration foundation
- CI non-Vercel hosting guard
- production seam smoke workflow

## Product correctness principles

Do not mark work complete based on a commit alone.

A capability is only production-complete when the relevant layers are verified:

- code merged,
- CI green,
- migrations applied,
- deployment healthy,
- runtime path works,
- user-facing behavior works where applicable,
- outcome/learning telemetry is recorded for autonomous completion behavior.

## Next recommended execution order

1. Finish and verify Netlify source deployment/custom-domain cutover.
2. Run authenticated AI provider Settings acceptance tests against Netlify + Render + Vault.
3. Implement the multi-iteration finish-until-target controller.
4. Add Finish Portfolio self-healing parity.
5. Connect per-repo completion sessions into portfolio orchestration.
6. Add stronger application-specific product-flow acceptance suites.
7. Remove residual `@vercel/functions` dependency with a provider-neutral background lifecycle.
8. Verify/upgrade Render production capacity.
9. Run real repositories end-to-end and use the measured outcomes to tune reasoning/repair strategy rather than judging success from synthetic tests alone.

## Updating this file

Whenever a priority above is completed:

- cite the implementing PR/commit in the updated text,
- record whether production deployment was verified,
- remove obsolete warnings rather than accumulating contradictory status,
- move newly discovered gaps into the priority register with evidence.