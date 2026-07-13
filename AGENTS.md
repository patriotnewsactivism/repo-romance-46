# AGENTS.md — Repo Triage & Completion Tool

## Safety Rails (NON-NEGOTIABLE)

These rules are enforced in code via `src/lib/safety-rails.ts`. They are not just prompts — they are runtime checks that throw errors before any GitHub API write.

1. **Never auto-merge PRs.** All changes land as PRs for human review.
2. **Never force-push.** Blocked at the code level.
3. **Never write directly to main/master/production/staging.** All writes go to feature branches.
4. **Never auto-delete or overwrite files across repository boundaries.**
5. **All cross-repo or radical architectural changes must include explicit risk callouts.**
6. **Default scope: ONE repo at a time.** Multi-repo merge is a distinct, higher-risk mode.

## Architecture

- `src/lib/safety-rails.ts` — Safety enforcement layer. Every GitHub write goes through `safeGitHubWrite()`.
- `src/lib/deep-analysis.functions.ts` — Deep structural analysis: reads code to detect stubs, check deps, measure test coverage, assess deploy readiness, calculate honest completion %.
- `src/lib/learning-log.functions.ts` — Persistent memory. Logs outcomes per repo and cross-repo. Checks history before re-suggesting failed patterns.
- `src/lib/repo-finisher.functions.ts` — AI code generation + PR creation. Integrated with safety rails and learning.
- `src/lib/analysis.functions.ts` — Portfolio-level AI analysis across all repos.
- `src/lib/swarm.functions.ts` — Parallel execution with autonomy controls.

## Key Principles

- **Honest assessments.** If a repo is 20% done, say "20% — early-stage scaffolding." Don't inflate.
- **Verify before declaring done.** Check that imports resolve, TypeScript compiles, and tests aren't broken.
- **Learn from failures.** Every finish attempt is logged. Before suggesting a fix, check if it's failed before.
- **Small, sequenced steps.** Break gaps into testable increments. Stop on failure — don't push forward blindly.
