---
name: RepoFinisher analysis pipeline reliability
description: Why the "run analysis" flow used to time out / fail for portfolios with many repos, and the async-job pattern used to fix it.
---

The GitHub-portfolio "run analysis" pipeline in `artifacts/api-server/src/routes/analysis.ts` used to run entirely inside the HTTP request handler for `POST /api/analysis/run`: fetch repos, digest each repo, then call the AI provider in **sequential** batches with fixed sleep delays between them. For portfolios with 40+ repos on the `github_models` provider (tiny ~4500 token batch budget → many small batches), this routinely exceeded the hard 240s server-side timeout, producing a 500 error the user saw as "it's not analyzing repos."

**Why:** long-running, multi-minute work should never be tied to the lifetime of a single HTTP request — it invites request/proxy/mobile-network timeouts unrelated to whether the work itself is healthy, and sequential AI batch calls with manual delays don't scale with portfolio size.

**How to apply:** the fix pattern now in place — keep following it for similar long-running jobs:
1. The route handler only creates a DB row (status `"running"`) and returns `{ id }` immediately; the actual work runs in a detached background function (fire-and-forget with its own try/catch that persists `"complete"`/`"failed"` + an `error` message used as a live progress log).
2. AI batches run with bounded concurrency (`parallelMap`, concurrency tuned per provider — low for rate-limited providers like `github_models`) instead of one-at-a-time with sleeps, with a small per-batch retry.
3. Both web and mobile clients now navigate to the analysis-detail page right away and poll (`refetchInterval`, ~2.5s while `status === "running"`) instead of blocking the run button/mutation until the whole pipeline finishes; they render dedicated "running" (spinner + progress message from `analysis.error`) and "failed" (with retry) states.
