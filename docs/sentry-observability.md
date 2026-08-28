# Sentry observability

RepoFinisher reports unexpected server failures, browser crashes, failed 5xx API operations, and sampled performance transactions when Sentry is configured. It does not enable session replay by default.

Request bodies, cookies, query strings, authorization headers, credentials, and user email addresses should be excluded. Browser identity should be limited to the minimum safe identifier needed for debugging.

## Production topology

- Browser/frontend Sentry configuration is built into the Netlify-deployed React/Vite SPA.
- Server Sentry configuration runs in the persistent Render API.
- Sentry is observability only; it must not become a secret store or authorization boundary.

## Production configuration

Frontend/runtime values:

- `VITE_SENTRY_DSN` — browser project DSN, available at build time
- `VITE_SENTRY_ENVIRONMENT` — normally `production`
- `VITE_SENTRY_TRACES_SAMPLE_RATE` — decimal from `0` to `1`

Server values:

- `SENTRY_DSN` — server project DSN
- `SENTRY_ENVIRONMENT` — normally `production`
- `SENTRY_TRACES_SAMPLE_RATE` — decimal from `0` to `1`

For readable minified stack traces, configure build-only source-map upload values on the frontend build environment:

- `SENTRY_AUTH_TOKEN` — private organization token allowed to upload releases/artifacts
- `SENTRY_ORG` — organization slug
- `SENTRY_PROJECT` — project slug
- `SENTRY_RELEASE` — immutable release identifier, normally a Git commit/deployment identifier supplied by CI/hosting

Never expose `SENTRY_AUTH_TOKEN` through a `VITE_` variable.

Do not rely on Vercel-specific release variables. RepoFinisher production hosting is Netlify + Render.

## Verification

1. Deploy the frontend/API with the relevant DSNs and environment values configured.
2. Confirm the API health endpoint reports expected observability status when that metadata is exposed.
3. Verify the release and uploaded frontend source-map artifacts in Sentry.
4. Exercise a controlled error in a non-production environment.
5. Confirm readable source frames.
6. Confirm no request body, cookies, query string, authorization header, provider key, GitHub token, Vault secret, service-role key, or email is present in the event.
7. Confirm expected 4xx responses do not create noisy error events while unexpected 5xx failures do.

## Release naming

Use a stable identifier tied to the deployed source revision. Prefer the Git commit SHA used by Netlify/Render or an explicit CI-provided `SENTRY_RELEASE`.

The frontend and API should use compatible release identifiers when practical so cross-service incidents can be correlated.

## Production issue inspection

If an operator uses a Sentry API token for issue inspection, keep it in the operator's secure local/deployment environment. Do not paste it into tickets, chat, source files, screenshots, or logs.

## Relationship to RepoFinisher internal telemetry

Sentry should be correlated with RepoFinisher's own durable operational evidence:

- completion events,
- reasoning traces,
- CI repair attempts,
- outcome metrics,
- product-readiness runs,
- operational learning memories.

Sentry tells us what the runtime did. RepoFinisher's internal telemetry tells us what the autonomous workflow decided and whether that decision improved the repository.