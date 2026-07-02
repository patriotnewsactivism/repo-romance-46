# RepoFinisher

AI-powered audit of your GitHub portfolio. Connect your GitHub, deep-sample every repo, and get concrete recommendations on what to **finish**, **combine**, and **repurpose**.

## What it does

1. **Connect GitHub** — OAuth one-click, reads your repos
2. **Deep sample** — Fetches metadata, README, file tree, and key source files for up to 25 repos
3. **AI analysis** — Generates ranked recommendations:
   - **Finish**: Repos ~80% done with exactly what's missing to ship
   - **Combine**: Groups of repos that together form a stronger product
   - **Repurpose**: Existing code repositioned as a marketable tool/SaaS
4. **Marketing copy** — Each recommendation includes a ready-to-post tweet + LinkedIn post
5. **Portfolio stats** — Language breakdown, total stars, dormant repos, most active repo
6. **Share** — Generate public shareable links for your analysis
7. **Export** — Download as Markdown or JSON

## Tech stack

- **TanStack Start** — Full-stack React framework with file-based routing
- **Supabase** — Auth, Postgres database, RLS
- **Lovable AI Gateway** — AI analysis via Google Gemini
- **GitHub OAuth** — Repository access
- **Tailwind CSS v4** — Terminal-inspired dark theme

## Setup

1. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps)
   - Callback URL: `https://<your-domain>/api/public/github/callback`
2. Set environment variables:
   - `GITHUB_CLIENT_ID` — GitHub OAuth App client ID
   - `GITHUB_CLIENT_SECRET` — GitHub OAuth App client secret
   - `SUPABASE_URL` — Supabase project URL
   - `SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key
   - `LOVABLE_API_KEY` — Lovable AI gateway key
   - `APP_ORIGIN` — Your app's origin URL (e.g. `https://myapp.lovable.app`)
3. Run Supabase migrations
4. `bun install && bun run dev`

## Database schema

- `github_connections` — user_id, github_login, access_token, scope, connected_at
- `analyses` — id, user_id, status, repo_count, summary_md, portfolio_stats, is_public, share_slug, error, created_at
- `analysis_items` — id, analysis_id, kind, title, repos, pitch, effort, market_potential, next_steps, tech_stack, marketing_tweet, marketing_linkedin, estimated_hours, rank

All tables have RLS enabled — users can only see their own data. Public sharing uses a separate RLS policy that allows anonymous reads on explicitly shared analyses.
