---
name: Supabase env var conventions
description: Which Supabase env vars the frontend and backend each need, and the https:// gotcha.
---

# Supabase env var conventions

## Rule
- Frontend (Vite): needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Replit Secrets
- Backend (api-server): reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` or falls back to `VITE_SUPABASE_URL`
- `SUPABASE_URL` from some older Replit secrets may lack the `https://` prefix — always normalise before passing to createClient

**Why:** Vite strips env vars not prefixed with `VITE_` from the browser bundle. The api-server sees all env vars. A missing `https://` on SUPABASE_URL will silently produce an invalid base URL.

**How to apply:**
- When setting up a new workspace, use `requestSecrets` for both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- In api-server code: `const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL`; then ensure it starts with `https://`
