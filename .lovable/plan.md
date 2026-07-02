# RepoFinisher — GitHub Portfolio Analyzer

An app that connects to your GitHub, deep-samples your repos, and uses AI to identify:

- Repos that are ~80% done and could be shipped with focused effort
- Groups of repos that can be **combined** into a stronger product
- Concrete "market as X" positioning + effort/impact scores

Output: a browsable ranked board **plus** a downloadable Markdown report.

## User flow

1. Sign in (email/password via Lovable Cloud)
2. Connect GitHub (OAuth) — one-click authorize
3. Click **Run analysis** → progress view as repos are scanned
4. See ranked results (Finish / Combine / Repurpose cards)
5. Download report as `.md`
6. Analyses are saved to history

## Screens

- `/auth` — sign in / sign up
- `/` (protected) — dashboard: Connect GitHub CTA, list of past analyses, "Run new analysis" button
- `/analysis/$id` — full report view with ranked cards, filters (Finish / Combine / Repurpose), export button
- `/settings` — GitHub connection status, disconnect

## Data model (Lovable Cloud / Postgres)

- `github_connections` — `user_id`, `github_login`, `access_token` (encrypted at rest), `connected_at`
- `analyses` — `id`, `user_id`, `status` (pending/running/complete/failed), `created_at`, `repo_count`, `summary_md`
- `analysis_items` — `id`, `analysis_id`, `kind` (finish/combine/repurpose), `title`, `repos jsonb` (repo names), `pitch`, `effort` (1–5), `market_potential` (1–5), `next_steps jsonb`, `rank`

RLS: everything scoped to `auth.uid()`.

## Server logic (TanStack `createServerFn`)

- `startGithubOAuth()` → returns GitHub authorize URL with `state`
- `/api/public/github/callback` (server route) → exchanges code for token, stores in `github_connections`, redirects to `/`
- `runAnalysis()` (protected):
  1. Fetch user repos via GitHub API (owned, non-fork by default)
  2. For each repo (cap ~30 most recently pushed): fetch metadata, README, file tree, and sample up to ~8 key source files (`package.json`, entry files, largest `.ts`/`.py`/etc.)
  3. Build a compact per-repo digest
  4. Call Lovable AI (`google/gemini-3-flash-preview`) with structured output to return an array of Finish / Combine / Repurpose recommendations, each with pitch, effort, market_potential, next_steps
  5. Persist to `analyses` + `analysis_items`
- `listAnalyses()`, `getAnalysis(id)`, `exportAnalysisMarkdown(id)`

## AI

Uses Lovable AI Gateway (no external key needed). Deep code sampling: metadata + README + tree + selected source files, budgeted per repo to keep tokens reasonable.

## Secrets you'll need to provide

To enable "Sign in with GitHub" I need a **GitHub OAuth App** (Lovable Cloud doesn't broker GitHub natively). You'll:

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://<your-app>.lovable.app/api/public/github/callback` (I'll show you the exact URL)
3. Paste the Client ID and Client Secret — I'll store them securely

App login itself is email/password (Lovable Cloud). GitHub OAuth is used only to authorize repo access.

## Design

Dark, terminal-inspired but polished: near-black background, mono display font for headings (JetBrains Mono), Inter for body, electric-green accent for "ship-ready" items, amber for "needs work", violet for "combine". Cards with subtle grid background, monospaced repo names, badge chips for language/stars/last-commit.

## Out of scope (v1)

- Automatically opening PRs
- Reading private orgs the user doesn't own
- Continuous monitoring / webhooks (can add later)
