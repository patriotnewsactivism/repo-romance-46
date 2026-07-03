---
name: Supabase URL secret missing scheme
description: SUPABASE_URL secret value can be malformed (missing https://) while VITE_SUPABASE_URL is well-formed, breaking server-side Supabase admin/client creation with "Invalid supabaseUrl" errors.
---

In this environment, the `SUPABASE_URL` secret was stored without the `https://` scheme prefix (just the host), causing `@supabase/supabase-js` `createClient()` to throw `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.` The `VITE_SUPABASE_URL` secret (same underlying project) was correctly formed with the scheme.

**Why:** Server-side code (Express backend) read `process.env.SUPABASE_URL` directly and failed at runtime the first time a code path actually exercised it (e.g. admin user creation, JWT-scoped client creation) — this wasn't caught by typecheck or a quick server boot, only by an actual API call.

**How to apply:** When wiring server-side Supabase clients (admin client, per-request JWT-scoped client, etc.), prefer `process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL` (and similarly `VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY`) as a fallback chain — mirroring the pattern already used in public/anon-key routes. If a "Invalid supabaseUrl" error appears, check whether the non-VITE secret is missing its `https://` prefix before assuming a code bug.
