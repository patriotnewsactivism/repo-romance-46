# Sentry observability

RepoFinisher reports unexpected server failures, browser crashes, failed 5xx API operations, and sampled performance transactions. It does not enable session replay. Request bodies, cookies, query strings, authorization headers, credentials, and user email addresses are excluded; browser identity is limited to the Supabase user ID. If the browser DSN is omitted, authenticated crash reports fall back to the server relay and the existing local recovery boundary remains active.

## Production configuration

Set these runtime variables in the deployment platform:

- `SENTRY_DSN` — server project DSN
- `VITE_SENTRY_DSN` — browser project DSN, available at build time
- `SENTRY_ENVIRONMENT` and `VITE_SENTRY_ENVIRONMENT` — normally `production`
- `SENTRY_TRACES_SAMPLE_RATE` and `VITE_SENTRY_TRACES_SAMPLE_RATE` — decimal values from `0` to `1`; the default is `0.05`

For readable minified stack traces, also set the following build-only values:

- `SENTRY_AUTH_TOKEN` — a Sentry organization token allowed to upload releases and artifacts
- `SENTRY_ORG` — organization slug
- `SENTRY_PROJECT` — project slug
- `SENTRY_RELEASE` — optional when `VERCEL_GIT_COMMIT_SHA` is available

Never expose the auth token through a `VITE_` variable. The Vite and esbuild plugins upload source maps only when the token, organization, project, and release are all available, then remove uploaded map files from browser output.

## Verification

1. Deploy with both runtime DSNs and the build-only upload variables configured.
2. Request `GET /api/healthz`. Confirm `observability.sentry.enabled` is `true`, the environment is correct, and the release matches the deployment commit.
3. Verify the release and its artifacts in Sentry.
4. Exercise a controlled error in a non-production environment and confirm the server or browser event has readable source frames and no request body, cookies, query string, authorization header, email, or repository contents.
5. Check that normal `4xx` responses do not create browser error noise and that unexpected `5xx` failures do.

Production issue inspection requires a separate read-only API token in the operator's local `SENTRY_AUTH_TOKEN` environment variable. Do not paste that token into tickets, chat, source files, or deployment logs.
