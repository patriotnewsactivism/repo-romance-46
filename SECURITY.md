# Security Policy

RepoFinisher's production security model is built around Vercel, Railway, Supabase, and GitHub.

## Secret placement

### Vercel

Only browser-safe values may be exposed through `VITE_*`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` / publishable key
- `VITE_API_BASE_URL`
- browser-safe Sentry DSN/environment values

Never expose trusted backend keys, provider API keys, GitHub access tokens, signing secrets, or encryption keys through Vercel client variables.

### Railway

Trusted server-only values belong on the Railway API/worker services:

- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `PLAN_SIGNING_SECRET`
- `SECRET_ENCRYPTION_KEY`
- server-side AI provider keys when platform-managed
- server-side Sentry credentials
- research provider keys such as `TAVILY_API_KEY`

The API and worker may share the same trusted secrets when they require the same server-side capabilities.

### Supabase

Supabase remains authoritative for authentication, RLS, durable execution state, and Vault-backed user credentials.

GitHub OAuth Client ID/Secret are configured under Supabase Authentication → Sign In / Providers → GitHub.

Normal browser users must never receive service-role access or decrypted Vault credentials.

## GitHub credentials

Stored GitHub provider/access tokens are sensitive server-side credentials. Do not log them, return them in API responses, or place them in repository source.

OAuth access requested by RepoFinisher should remain limited to what the product needs.

## Repository writes

Repository mutation must preserve:

- exact repository identity;
- base SHA binding;
- explicit plan/approval state;
- isolated branch writes;
- draft PR boundaries;
- CI verification;
- bounded repair;
- no automatic merge unless a future explicit policy authorizes it.

## Network boundaries

CORS must allow only approved frontend origins.

The production API should accept `https://portfolio.donmatthews.live` and explicitly configured Vercel production/preview origins as needed. Do not use wildcard credentialed CORS.

## Legacy infrastructure

Cloud Run, Google Secret Manager bindings for this project, and Cloud Run Jobs are retired deployment infrastructure. Historical files may remain for audit/migration context, but they are not the active security boundary.
