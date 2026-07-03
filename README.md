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

### Pages

- `/` — Landing page with feature overview
- `/auth` — Sign in / sign up
- `/dashboard` — Portfolio summary, run analysis, past analyses, starred items
- `/analysis/$id` — Full analysis results with recommendations
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
- `analysis_items` — individual recommendations (ranked, with star tracking)
- `github_connections` — OAuth tokens
- `user_preferences` — scheduling, BYOK, filters, notifications

### Scheduled Analysis

The cron endpoint at `/api/cron/scheduled-analysis` runs all due analyses.
Configure in `vercel.json` (Vercel) or `wrangler-cron.jsonc` (Cloudflare).
Protected by `CRON_SECRET` bearer token.

## License

MIT
