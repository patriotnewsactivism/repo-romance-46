# repo_finisher

Ship the repos you already started. Connect your GitHub, get an AI-powered audit
of your portfolio â which repos to finish, combine, or repurpose.

## Features

### Core

- **GitHub OAuth integration** â one-click connect, reads up to 25 repos
- **AI portfolio analysis** â ranked recommendations (finish / combine / repurpose)
- **Tech stack detection** â AI identifies frameworks/languages/tools per recommendation
- **Marketing copy** â auto-generated tweet + LinkedIn post per recommendation
- **Estimated hours** â realistic time estimates for each recommendation
- **Action Plan generator** â phased execution roadmap with quick wins and moonshots
- **Repo health scoring** â CI status, test detection, license check, activity grade (A-F)
- **Combine merge instructions** â actual git commands to merge repos into a new product
- **Portfolio stats** â language breakdown, star count, dormant repos, activity timeline
- **Shareable links** â toggle public sharing with auto-generated slug
- **Export** â Markdown + JSON download
- **Re-run analysis** â fresh analysis with latest repo data
- **Delete analysis** â with confirmation on both analysis page and dashboard

### Deep Structural Analysis (NEW)

- **Built vs. stubbed detection** â reads actual source code to find TODO/FIXME/HACK comments, empty function bodies, placeholder implementations, and `NotImplementedError` throws
- **Honest completion percentage** â grounded in code metrics (function completeness, test coverage, deploy readiness, documentation), not vibes. Categories: abandoned scaffolding / early-stage / half-built / mostly-done / shippable
- **Dependency health** â checks npm registry for outdated packages, flags major version gaps
- **Test coverage analysis** â detects test framework, counts test files, maps which directories have test coverage and which don't
- **Deploy readiness check** â verifies build scripts, deploy configs (Vercel/Netlify/Docker/etc.), env var requirements, and flags gaps
- **File breakdown** â categorizes all files into source, test, config, docs, and other

### Safety Rails (enforced in code, not just prompted)

- **Never auto-merge** â all changes land as PRs for human review
- **Never force-push** â blocked at the code level before any GitHub API call
- **Never touch main/production** â protected branch writes are rejected with clear errors
- **Cross-repo safety** â destructive operations across repo boundaries are blocked
- **Risk assessment on every PR** â each PR includes a risk callout (low/medium/high/critical) with specific factors and recommendations
- **Scope discipline** â operates on ONE repo at a time by default; multi-repo merge is a distinct higher-risk mode requiring explicit action

### Persistent Learning (NEW)

- **Per-repo memory** â logs what worked, what broke, and what took longer than expected on each repo
- **Cross-repo patterns** â detects recurring fix patterns across multiple repos with success/failure tracking and confidence scores
- **History check before suggesting** â before re-suggesting a fix pattern, checks if it's failed before on this repo or similar repos
- **Pattern detection** â automatically flags recurring failures, slow operations, and frequently-changed files

### AI Provider Options (BYOK)

- **GitHub Models â GPT-4o** (free, uses your GitHub token, no API key needed)
- **OpenAI** (bring your own key)
- **Anthropic / Claude** (bring your own key)
- **Google / Gemini** (bring your own key)

### Productivity

- **Starred recommendations** â star items to track which you're acting on
- **Scheduled re-analysis** â weekly or monthly auto-scans of your portfolio
- **Email notifications** â get emailed when analyses complete
- **Analysis filters** â filter by languages, minimum stars, exclude archived

### "Vibe Code to Completion"

- **Sequenced steps** â breaks the gap between current state and "done" into small, testable increments
- **Build verification** â enforces that generated code has valid imports, correct TypeScript, and follows existing project style
- **Stop on failure** â if a step fails or the build breaks, stops and reports the real failure instead of pushing forward
- **Multi-pass finishing** â iterative passes (docs â tests â code fixes â polish) with each pass building on the last
- **Swarm execution** â run finish/combine/spec generation across multiple repos in parallel with careful autonomy controls

### Pages

- `/` â Landing page with feature overview
- `/auth` â Sign in / sign up
- `/dashboard` â Portfolio summary, run analysis, past analyses, starred items
- `/analysis/$id` â Full analysis results with recommendations, deep analysis, learning history
- `/settings` â AI provider, scheduling, filters, starred items, GitHub connection
- `/shared/$slug` â Public shared analysis (no auth required)

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

- `analyses` â analysis runs (status, summary, portfolio stats, sharing)
- `analysis_items` â individual recommendations (ranked, with star tracking, deep analysis)
- `github_connections` â OAuth tokens
- `user_preferences` â scheduling, BYOK, filters, notifications
- `repo_learnings` â per-repo persistent memory (history, patterns, deep analysis results)
- `cross_repo_patterns` â recurring fix patterns with success/failure tracking
- `swarm_runs` â parallel execution tracking

### Scheduled Analysis

The cron endpoint at `/api/cron/scheduled-analysis` runs all due analyses.
Configure in `vercel.json` (Vercel) or `wrangler-cron.jsonc` (Cloudflare).
Protected by `CRON_SECRET` bearer token.

## Architecture

```
src/
âââ lib/
â   âââ analysis.functions.ts       # Portfolio analysis (AI-powered)
â   âââ deep-analysis.functions.ts  # Structural code analysis
â   âââ repo-finisher.functions.ts  # AI code generation + PR creation
â   âââ safety-rails.ts             # Safety enforcement layer
â   âââ learning-log.functions.ts   # Persistent learning memory
â   âââ swarm.functions.ts          # Parallel execution
â   âââ vibe-tools.functions.ts     # Market analysis, specs, combine
â   âââ ai-provider.ts              # Multi-provider AI routing
â   âââ github.functions.ts         # GitHub OAuth + health scoring
âââ components/
â   âââ DeepAnalysis.tsx            # Deep structural analysis UI
â   âââ CrossRepoPatterns.tsx       # Cross-repo pattern display
â   âââ RepoFinisher.tsx            # Finish repo button + results
â   âââ SwarmRunner.tsx             # Swarm execution UI
â   âââ ...                         # UI components
âââ routes/                         # TanStack Router pages
```

## License

MIT
