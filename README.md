# repo_finisher

Ship the repos you already started. Connect your GitHub, get an AI-powered audit
of your portfolio — which repos to finish, combine, or repurpose.

## Features

### Core

- **GitHub OAuth integration** — one-click connect, reads up to 25 repos
- **AI portfolio analysis** — ranked recommendations (finish / combine / repurpose)
- **Tech stack detection** — AI identifies frameworks/languages/tools per recommendation
- **Marketing copy** — auto-generated tweet + LinkedIn post per recommendation
- **Estimated hours** — realistic time estimates for each recommendation
- **Action Plan generator** — phased execution roadmap with quick wins and moonshots
- **Repo health scoring** — CI status, test detection, license check, activity grade (A-F)
- **Combine merge instructions** — actual git commands to merge repos into a new product
- **Portfolio stats** — language breakdown, star count, dormant repos, activity timeline
- **Shareable links** — toggle public sharing with auto-generated slug
- **Export** — Markdown + JSON download
- **Re-run analysis** — fresh analysis with latest repo data
- **Delete analysis** — with confirmation on both analysis page and dashboard

### Deep Structural Analysis (NEW)

- **Built vs. stubbed detection** — reads actual source code to find TODO/FIXME/HACK comments, empty function bodies, placeholder implementations, and `NotImplementedError` throws
- **Honest completion percentage** — grounded in code metrics (function completeness, test coverage, deploy readiness, documentation), not vibes. Categories: abandoned scaffolding / early-stage / half-built / mostly-done / shippable
- **Dependency health** — checks npm registry for outdated packages, flags major version gaps
- **Test coverage analysis** — detects test framework, counts test files, maps which directories have test coverage and which don't
- **Deploy readiness check** — verifies build scripts, deploy configs (Vercel/Netlify/Docker/etc.), env var requirements, and flags gaps
- **File breakdown** — categorizes all files into source, test, config, docs, and other

### Safety Rails (enforced in code, not just prompted)

- **Never auto-merge** — all changes land as PRs for human review
- **Never force-push** — blocked at the code level before any GitHub API call
- **Never touch main/production** — protected branch writes are rejected with clear errors
- **Cross-repo safety** — destructive operations across repo boundaries are blocked
- **Risk assessment on every PR** — each PR includes a risk callout (low/medium/high/critical) with specific factors and recommendations
- **Scope discipline** — operates on ONE repo at a time by default; multi-repo merge is a distinct higher-risk mode requiring explicit action

### Persistent Learning (NEW)

- **Per-repo memory** — logs what worked, what broke, and what took longer than expected on each repo
- **Cross-repo patterns** — detects recurring fix patterns across multiple repos with success/failure tracking and confidence scores
- **History check before suggesting** — before re-suggesting a fix pattern, checks if it's failed before on this repo or similar repos
- **Pattern detection** — automatically flags recurring failures, slow operations, and frequently-changed files

### AI Provider Options (BYOK)

- **GitHub Models — GPT-4o** (free, uses your GitHub token, no API key needed)
- **OpenAI** (bring your own key)
- **Anthropic / Claude** (bring your own key)
- **Google / Gemini** (bring your own key)

### Productivity

- **Starred recommendations** — star items to track which you're acting on
- **Scheduled re-analysis** — weekly or monthly auto-scans of your portfolio
- **Email notifications** — get emailed when analyses complete
- **Analysis filters** — filter by languages, minimum stars, exclude archived

### "Vibe Code to Completion"

- **Sequenced steps** — breaks the gap between current state and "done" into small, testable increments
- **Build verification** — enforces that generated code has valid imports, correct TypeScript, and follows existing project style
- **Stop on failure** — if a step fails or the build breaks, stops and reports the real failure instead of pushing forward
- **Multi-pass finishing** — iterative passes (docs → tests → code fixes → polish) with each pass building on the last
- **Swarm execution** — run finish/combine/spec generation across multiple repos in parallel with careful autonomy controls

### Pages

- `/` — Landing page with feature overview
- `/auth` — Sign in / sign up
- `/dashboard` — Portfolio summary, run analysis, past analyses, starred items
- `/analysis/$id` — Full analysis results with recommendations, deep analysis, learning history
- `/settings` — AI provider, scheduling, filters, starred items, GitHub connection
- `/shared/$slug` — Public shared analysis (no auth required)

## Tech Stack

- TanStack Start (React + server functions)
- Supabase (auth + Postgres + RLS)
- GitHub OAuth (read repo access)
- OpenAI, Anthropic, Google, or GitHub Models API
- Cloudflare Workers / Vercel deployment

## Setup

### Environment Variables

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...                  # protects /api/cron/scheduled-analysis
RESEND_API_KEY=...               # optional, for email notifications
APP_URL=https://your-app.com     # used in email links
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### Database

Run migrations in `supabase/migrations/` to create the schema:

- `analyses` — analysis runs (status, summary, portfolio stats, sharing)
- `analysis_items` — individual recommendations (ranked, with star tracking, deep analysis)
- `github_connections` — OAuth tokens
- `user_preferences` — scheduling, BYOK, filters, notifications
- `repo_learnings` — per-repo persistent memory (history, patterns, deep analysis results)
- `cross_repo_patterns` — recurring fix patterns with success/failure tracking
- `swarm_runs` — parallel execution tracking

### Scheduled Analysis

The cron endpoint at `/api/cron/scheduled-analysis` runs all due analyses.
Configure in `vercel.json` (Vercel) or `wrangler-cron.jsonc` (Cloudflare).
Protected by `CRON_SECRET` bearer token.

## Architecture

```
src/
├── lib/
│   ├── analysis.functions.ts       # Portfolio analysis (AI-powered)
│   ├── deep-analysis.functions.ts  # Structural code analysis
│   ├── repo-finisher.functions.ts  # AI code generation + PR creation
│   ├── safety-rails.ts             # Safety enforcement layer
│   ├── learning-log.functions.ts   # Persistent learning memory
│   ├── swarm.functions.ts          # Parallel execution
│   ├── vibe-tools.functions.ts     # Market analysis, specs, combine
│   ├── ai-provider.ts              # Multi-provider AI routing
│   └── github.functions.ts         # GitHub OAuth + health scoring
├── components/
│   ├── DeepAnalysis.tsx            # Deep structural analysis UI
│   ├── CrossRepoPatterns.tsx       # Cross-repo pattern display
│   ├── RepoFinisher.tsx            # Finish repo button + results
│   ├── SwarmRunner.tsx             # Swarm execution UI
│   └── ...                         # UI components
└── routes/                         # TanStack Router pages
```

## License

MIT
