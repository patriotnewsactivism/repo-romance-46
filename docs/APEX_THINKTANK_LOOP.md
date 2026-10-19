# Apex ↔ Think Tank self-heal loop

Scheduled job that turns a new Apex failure into a **verified draft PR**, or does nothing. Invariant: *consensus is not verification*. Only a regression test that fails on the base commit and passes with the patch counts.

```
Apex /api/health/components ──► gate (no LLM spend) ──► Think Tank /api/debate ──► LOCAL verify ──► draft PR in Apex
```

Runs in `.github/workflows/apex-thinktank-sync.yml` every 30 minutes (best-effort cron; each tick is idempotent). Code: `scripts/src/apex-sync/`.

## Stages

1. **Observe** (`observe.ts`): `GET {APEX_BASE_URL}/api/health/components` with a read-only Bearer token. Any HTTP/shape/transport failure fails the job closed (red run, no action).
2. **Gate** (`ledger.ts`, before any LLM call): skip when an auto-fix PR is already open (`maxOpenPrs=1`, read from GitHub), the signature already has a PR (7 d) or was blocked (24 h), or the daily debate cap (4) is reached. The ledger is a JSON file restored via `actions/cache`; a corrupt ledger aborts rather than resetting the cap. Cache eviction can lose the ledger; the open-PR check still prevents duplicate PRs.
3. **Plan** (`plan.ts`): builds the handoff payload (`trace_id`, `incident`, `proposed_patch`, `debate_constraints`). An incident whose component has no entry in `component-map.json` has no files in scope and is `BLOCKED` before any spend.
4. **Debate** (`thinktank.ts`): adapter onto the **existing** Think Tank API: `POST /api/debate {input, customContext, maxRounds≤2}` → poll `GET /api/debate/runs/:id` → `GET …/export/changes`. Think Tank is unauthenticated; no secrets or tokens are ever sent. 10-minute deadline, response-size caps, deletions rejected, no retries inside the adapter.
5. **Verify** (`verify.ts`, the only authority): allowed paths only (planned files plus exactly the regression test in the same package; never `.github/`, `package.json`, lockfiles, `.env*`). Then: tests-only patch must **fail** (and actually run), full patch must **pass**, package `typecheck` must pass. One revision pass back to Think Tank on failure, then `BLOCKED`.
6. **Ship** (`pr.ts`): push `fix/apex-<trace>` and open a **draft** PR in Apex with before/after exit codes. No merge, no push to `main`, no deploy trigger.

Verdicts: `VERIFIED` (draft PR opened), `BLOCKED` (proof missing/failed; cooldown applies), `SKIPPED` (gated or dry-run), `NO_SIGNAL`. The result is written to the job summary.

## Setup (operator actions)

| Kind | Name | Notes |
|---|---|---|
| secret | `APEX_API_KEY` | Read-only Apex token. Apex currently only has Bearer admin auth; mint a least-privilege token rather than reusing admin. |
| secret | `APEX_REPO_TOKEN` | Fine-grained PAT, repository `patriotnewsactivism/Apex` only, contents + pull requests write. `GITHUB_TOKEN` cannot write cross-repo. |
| variable | `APEX_BASE_URL` | e.g. the Apex Railway/public URL. |
| variable | `THINKTANK_ENDPOINT` | Optional; default `https://debate.donmatthews.live` (a trailing `/api/debate` is tolerated). |
| variable | `APEX_SYNC_LIVE` | Must be `true` to act. Anything else is a dry run that logs the would-be payload. |

`scripts/src/apex-sync/component-map.json` maps an Apex component key to the repo-relative files a fix may touch, e.g. `{"tasks": ["packages/api-server/src/routes/tasks.ts"]}`. Empty by default, so nothing is debated until an operator opts a component in.

Manual run: *Actions → Apex ThinkTank Sync → Run workflow*. `dry_run` defaults to true; `incident_override` accepts `{"component","errorSignature","files":[…],"severity"}` to exercise the pipeline on a known case.

## Known limits

- Verification installs Apex dependencies (`pnpm install --frozen-lockfile`); Apex has a GitHub-hosted dependency (`apex-copilot`), so the PAT must be able to read it or the install blocks the run.
- Think Tank's own sandbox runs only install/typecheck/build, not the target repo's tests; that is why verification is local.
- A verified draft PR is still reviewed and merged by a person. Apex's own release verification (CI, Railway deployment and health) remains the deploy authority.
