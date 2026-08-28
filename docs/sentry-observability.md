# Sentry observability

RepoFinisher reports unexpected server failures, browser crashes, failed 5xx API operations, and sampled performance transactions when Sentry is configured. It does not enable session replay. Request bodies, cookies, query strings, authorization headers, credentials, and user email addresses should remain excluded; browser identity is limited to the Supabase user ID. If the browser DSN is omitted, the existing local recovery boundary remains active and server-side observability may still operate independently.

## Production configuration

Backend/runtime values belong on Render:

- `SENTRY_DSN` — server project DSN
- `SENTRY_ENVIRONMENT` — normally `production`
- `SENTRY_TRACES_SAMPLE_RATE` — decimal value from `0` to `1`; start conservatively

Frontend build values belong on Netlify:

- `VITE_SENTRY_DSN` — browser project DSN
- `VITE_SENTRY_ENVIRONMENT` — normally `production`
- `VITE_SENTRY_TRACES_SAMPLE_RATE` — browser trace sampling rate

For readable minified stack traces, configure build-only upload values on the build environment that creates the relevant artifact:

- `SENTRY_AUTH_TOKEN` — Sentry organization token allowed to upload releases/artifacts
- `SENTRY_ORG` — organization slug
- `SENTRY_PROJECT` — project slug
- `SENTRY_RELEASE` — explicit release identifier, preferably the deployed Git commit SHA

Never expose `SENTRY_AUTH_TOKEN` through a `VITE_` variable. Vite/browser values are public build output.

## Verification

1. Deploy with the intended runtime/browser DSNs and source-map upload configuration.
2. Request `GET /api/healthz` and confirm the API reports the expected observability state/environment/release metadata.
3. Verify the deployed release and source-map artifacts in Sentry.
4. Exercise a controlled error in a non-production environment and confirm the event has readable source frames and no request body, cookies, query string, authorization header, credential values, user email, or unnecessary private repository contents.
5. Confirm expected application `4xx` responses do not create noisy error events and unexpected `5xx` failures do.

## Privacy and secret handling

Sentry must never receive:

- Supabase service-role keys;
- AI provider keys;
- GitHub access tokens;
- authorization headers;
- private keys;
- full credential-bearing request bodies; or
- secret values included in reasoning/repair prompts.

Production issue inspection requires an appropriately scoped read-only Sentry API token in an operator environment. Do not paste that token into tickets, chat, source files, deployment variables intended for the browser, or logs.

## Current status

Sentry integration exists in source, but production observability should not be described as fully verified until live ingestion and readable source-map behavior have been confirmed for the current Netlify + Render deployment. See `docs/CURRENT_STATUS.md` for the dated operational checkpoint.
