# RepoFinisher Project State

**Snapshot date:** 2026-08-29

This file is intentionally time-sensitive. Update it whenever production hosting, core completion behavior, security storage, or major implementation priorities change. Verify current code/deployments before relying on this snapshot for an irreversible action.

## Canonical source

Repository: `patriotnewsactivism/repo-romance-46`

Default branch: `main`

Current verified `main` at this checkpoint:

```text
d8faee9e4e94a3045fe43bb67256917974839901
chore: replace Vercel waitUntil with provider-neutral background runtime
```

`main` is branch-protected and requires the `CI` status check for non-admin merges.

## Production architecture

Approved architecture:

- Netlify — frontend SPA
- Render — persistent API and long-running agent work
- Supabase — authentication, database, RLS, Vault
- GitHub — source, branches, PRs, checks
- Sentry — observability when configured

Vercel is not an approved deployment target and must not be used again for RepoFinisher.

## Backend status

Canonical API endpoint:

```text
https://repofinisher-api-live.onrender.com
```

The source on `main` includes:

- provider/model Settings support for Google, OpenAI, Anthropic, and OpenRouter,
- Supabase Vault-backed AI BYOK storage,
- service-role-only Vault store/read/delete RPC usage,
- direct repository bounded self-healing,
- Finish Portfolio bounded self-healing parity,
- provider-neutral background runtime in place of Vercel `waitUntil`,
- multi-stage reasoning and measured operational learning.

At the Vault migration checkpoint, production Supabase had a Vault-backed AI credential reference and no remaining legacy plaintext AI-key row. This is a historical verification point, not permission to expose or print any credential value.

## Frontend / Netlify status requiring direct verification

A Netlify project named `repofinisher` exists.

The Netlify project reader reported:

```text
project: repofinisher
project id: 2a0328fa-7111-4054-86d0-0dba8f3b38c7
reported primarySiteUrl: http://repofinish.donmatthews.live
reported current deploy: no detailed deploy payload
```

The intended canonical product domain is:

```text
https://repofinisher.donmatthews.live
```

The `repofinish` versus `repofinisher` hostname discrepancy remains unresolved until the actual Netlify source deployment and custom-domain configuration are verified. Do not claim the frontend cutover is complete merely because the Netlify project exists.

Before closing the frontend migration:

1. Confirm current `main` is deployed on Netlify.
2. Confirm the build contains current Settings/BYOK and UI contrast fixes.
3. Confirm `VITE_API_BASE_URL` points to the Render API.
4. Confirm Supabase browser variables are present.
5. Confirm the custom domain is exactly `repofinisher.donmatthews.live` over HTTPS.
6. Run `.github/workflows/production-smoke.yml` or equivalent seam verification.
7. Verify authenticated Settings save/reload/test/remove flows.
8. Verify mobile header/menu/theme contrast on the actual Netlify deployment.

## AI provider / BYOK status

Source supports:

- Google
- OpenAI
- Anthropic
- OpenRouter

Preferences support an explicit provider and exact model identifier. New AI BYOK credentials use Supabase Vault and are read only through the trusted server path. Browser responses must never contain decrypted credentials.

Production acceptance still requires a real authenticated Netlify user flow proving save, reload, test, provider switch, and remove behavior against Render + Vault.

## Reasoning and learning state

Implemented foundations include:

- multi-stage repository evidence analysis,
- competing root-cause hypotheses,
- skeptical/verification critic,
- dynamically selected specialists,
- principal-plan synthesis,
- durable repo-local and cross-repo operational memory,
- measured outcome scoring,
- controlled prompt-strategy experiments,
- reasoning traces/audit data,
- reasoned bounded CI repair,
- direct-run and Finish Portfolio self-healing parity,
- external LLM completion prompts,
- continuous repository event reasoning,
- portfolio relationship analysis,
- product/security assurance runs.

Learning means measured operational memory and strategy adaptation. It is not autonomous model-weight retraining.

## Highest-priority remaining product work

### 1. Multi-iteration finish-until-target controller

The database contains `repo_completion_sessions`, but an end-to-end runtime controller still needs to prove the complete loop:

```text
reason -> implement -> verify -> rescore
   -> still below completion/readiness target or material blocker remains?
   -> reason again from fresh evidence
   -> next bounded iteration
```

This remains the most important completion-quality gap because a green first PR is not equivalent to a finished product.

### 2. Portfolio completion-session orchestration

Finish Portfolio now has bounded CI self-healing parity. The next step is to coordinate true per-repository iterative completion sessions while preserving each repository's independent:

- plan hash,
- branch,
- draft PR,
- CI state,
- repair attempts,
- budget/risk boundary,
- outcome telemetry,
- stop reason.

### 3. Product-specific acceptance depth

Generic assurance can inspect repository, CI, deployment, and live-surface evidence. Products involving login, payments, privileged operations, native/mobile flows, or complex state still need stronger application-specific acceptance definitions and browser/runtime evidence before RepoFinisher should call them complete.

### 4. Render capacity / background execution

Verify the canonical Render service plan and workload behavior under real portfolio reasoning, repair, and long-running jobs. Upgrade capacity based on measured cold starts, CPU/memory, concurrency, and latency rather than assumption.

### 5. Netlify production completion

Finish the first verified source deploy/custom-domain cutover and run the authenticated Settings and mobile UI acceptance tests listed above.

## Completed major foundations

Substantial capabilities present in `main` include:

- Repo Investment Intelligence and adaptive finishing
- measured post-run rescoring
- full portfolio value and one-click finishing foundations
- 500-repo analysis limit
- Finish Portfolio orchestration foundation
- direct and portfolio bounded self-healing CI
- tiered portfolio intelligence
- mobile/dark-theme contrast hardening
- deployment sandbox verification
- confidence-adjusted portfolio valuation
- controlled prompt evolution and specialist agents
- Reasoning & Learning OS schema/APIs
- portfolio consolidation graph
- security/product assurance
- continuous repository watch/event reasoning
- external LLM completion handoffs
- provider/model Settings including OpenRouter
- Supabase Vault-backed AI BYOK storage
- provider-neutral background runtime replacing `@vercel/functions`/Vercel `waitUntil`
- Netlify configuration and Render persistent API migration foundation
- non-Vercel CI hosting guard
- production seam smoke workflow

## Definition of completion

Do not mark work complete based on a commit, PR, or green CI alone.

Use `docs/DEFINITION_OF_DONE.md`. Relevant completion evidence can include:

- code merged,
- required migration applied,
- deployment healthy,
- runtime/user path verified,
- auth/data/payment/security behavior verified where applicable,
- completion/readiness re-scored,
- outcome/learning telemetry persisted,
- no known material blocker left inside scope.

## Recommended execution order

1. Complete and verify Netlify source deployment/custom-domain cutover.
2. Run authenticated AI Settings acceptance against Netlify + Render + Vault.
3. Implement the multi-iteration finish-until-target controller.
4. Connect per-repo completion sessions into Finish Portfolio orchestration.
5. Add product-specific acceptance suites/browser-flow verification.
6. Verify/upgrade Render production capacity where measurements justify it.
7. Run real repositories end-to-end and tune reasoning/repair strategy from measured outcomes rather than synthetic success alone.

## Documentation / governance checkpoint

PR #76 adds the missing operating-manual layer: Definition of Done, external-LLM handoff contract, incident response, release checklist, PR template, and structured issue templates. `README.md` and `AGENTS.md` are canonical entrypoints; model-specific instruction files must defer to `AGENTS.md` rather than fork policy.

## Updating this file

When a priority is completed:

- identify the implementing PR/commit,
- state whether deployment/runtime/user-flow verification actually occurred,
- remove obsolete warnings instead of accumulating contradictions,
- move newly discovered gaps into the priority register with evidence,
- keep secret values out of this file.
