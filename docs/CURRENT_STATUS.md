# Current RepoFinisher Status

**Checkpoint date:** 2026-08-28

This is a dated operational checkpoint, not a permanent architecture document. Update or replace it after material production changes so stale status does not become a second source of truth.

## Canonical source

- Repository: `patriotnewsactivism/repo-romance-46`
- Production branch: `main`
- Main commit at this checkpoint: `01ca24bf9b12b97b5c216cd1d33136a6aa8f737f`

## Backend

- Canonical API service: Render `repofinisher-api-live`
- API deploy for main commit `01ca24bf...` is **live**.
- That commit includes the Supabase Vault-backed AI BYOK integration.

## AI provider settings

Supported providers:

- Google
- OpenAI
- Anthropic
- OpenRouter

Provider/model saving has a dedicated Settings/API path rather than depending on unrelated preference fields.

User BYOK credentials are stored through Supabase Vault. The legacy plaintext BYOK row was migrated to a Vault reference and the Vault RPC permission checks were verified for `service_role`.

## Frontend / Netlify

- Netlify project exists: `repofinisher`.
- Production frontend build configuration is checked into `netlify.toml`.
- Required frontend environment values have been written to Netlify during the migration work.
- At this checkpoint, the Netlify project does **not yet show a completed source deploy** in the connected project status.
- The Netlify project metadata currently reports primary site URL `http://repofinish.donmatthews.live` while the intended canonical product domain is `https://repofinisher.donmatthews.live`. Verify/correct the custom-domain binding during final cutover.

Do not fall back to Vercel to work around this deployment gap.

## Supabase

Production Supabase contains the reasoning/learning, portfolio, continuous-repository, assurance and Vault migrations added during the current completion work.

Important security boundary: AI BYOK Vault read/write/delete functions are service-role-only. Browser-authenticated roles must not receive Vault plaintext access.

## Major capabilities implemented

- durable exact-plan completion runs;
- approval/hash/base-SHA binding;
- Finish Portfolio orchestration;
- bounded CI self-healing;
- deployment-preview sandbox verification;
- tiered portfolio intelligence;
- confidence-adjusted portfolio valuation;
- controlled prompt strategy evolution;
- dynamic specialist selection;
- multi-stage evidence/critic/planner reasoning;
- operational learning memory;
- compact reasoning/audit traces;
- portfolio relationship/consolidation graph;
- security/product assurance API;
- continuous-repository watch/event reasoning;
- detailed external-LLM completion handoffs; and
- dedicated AI provider/model Settings path including OpenRouter.

## Remaining high-priority verification/work

1. Complete the first source-backed Netlify production deploy from current `main`.
2. Correct/verify the canonical custom-domain binding and HTTPS.
3. Run the production smoke workflow against Netlify + Render + Supabase.
4. Exercise Settings end-to-end in the deployed frontend: save provider, exact model and BYOK key; re-open Settings; verify configured status; execute a provider test without exposing the key.
5. Finish wiring multi-iteration `finish until target` behavior so a repository can re-assess and continue after a successful bounded iteration when measurable completion/readiness targets remain unmet.
6. Ensure Finish Portfolio uses the same evidence-driven repair/iteration behavior as direct repository finishing rather than terminating too early on a child failure.
7. Replace remaining `@vercel/functions`/`waitUntil` runtime coupling with provider-neutral durable background execution, then remove the dependency.
8. Upgrade production API capacity from Render Free before significant portfolio/agent load if the service is still on the free plan.
9. Remove obsolete duplicate Render services after confirming only `repofinisher-api-live` is referenced by production.
10. Verify Sentry production ingestion/source maps if Sentry is expected to be an active production control.

## Product-policy reminders

- Vercel deployment is prohibited.
- Automatic merge remains disabled.
- “Learning” means measured operational memory/prompt strategy adaptation, not model-weight retraining.
- External-agent prompts complement RepoFinisher; they do not replace internal completion capability.
- A green build is not enough to call a repository finished.
