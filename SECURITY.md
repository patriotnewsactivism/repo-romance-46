# Security Policy

RepoFinisher can inspect and modify software repositories, interact with GitHub, store user-selected AI credentials, and operate against production-adjacent infrastructure. Security boundaries are therefore part of the product's core behavior.

## Reporting a vulnerability

Do **not** publish live credentials, exploit payloads, private repository contents, user data, or detailed reproduction steps for an unpatched vulnerability in a public issue.

Use a private repository security-advisory/reporting channel when available, or contact the repository owner through a private channel.

Include:

- affected component/route;
- impact;
- minimum reproduction information;
- whether credentials or user data may be exposed;
- affected commit/deployment when known; and
- suggested mitigation if available.

## Secrets

Never commit or log:

- GitHub tokens;
- Supabase service-role keys;
- AI provider API keys;
- Sentry auth tokens;
- private keys/certificates;
- plan-signing secrets;
- secret-encryption keys; or
- credentials belonging to target repositories.

Anything prefixed `VITE_` is browser-visible and must be treated as public build configuration.

### AI BYOK

User-supplied AI provider credentials are stored in Supabase Vault. Application rows store an opaque Vault secret ID. Vault plaintext must only be retrieved through trusted server-side service-role operations and must never be returned in API responses.

### GitHub connection credentials

GitHub connection tokens currently use the application's sealed-secret mechanism. They depend on `SECRET_ENCRYPTION_KEY`. If that key is rotated without a migration strategy, old tokens may become unreadable and users may have to reconnect GitHub.

## Authentication and authorization

- Browser authentication is provided by Supabase Auth.
- The API must verify the Supabase bearer token before trusting user identity.
- User-owned application data must remain protected by RLS/user scoping.
- Service-role access must never be exposed to the browser.
- Privileged database functions must be explicitly revoked from `anon` and `authenticated` unless public access is intentional and reviewed.

## Autonomous repository-write safety

RepoFinisher must not:

- write credential-bearing paths;
- expose discovered target-repository secrets in prompts/logs/PRs;
- modify an existing license autonomously;
- execute against a stale base SHA;
- weaken tests/security/CI/permissions to obtain a passing result;
- delete governance files during automatic repair; or
- silently auto-merge generated PRs.

Automatic CI repair has stricter path protections than ordinary planned changes.

## SSRF and runtime probing

Any server-side URL probing must restrict protocols/hosts appropriately and reject loopback, local-network, credential-bearing, or otherwise unsafe targets. Do not replace allowlists/host validation with a generic `fetch(userInput)` path.

## Database migrations

- Do not alter already-applied migration history.
- Review grants/RLS for new tables/functions.
- Use service-role-only RPCs for Vault operations.
- Verify production migration application before relying on the schema in deployed code.

## Dependency and supply-chain changes

Dependency additions should be justified by actual product need. Avoid adding provider-specific deployment/runtime packages when a provider-neutral implementation is practical.

Lockfiles and package acceptance scripts are protected from automatic CI repair.

## Observability/privacy

Sentry or other telemetry must not ingest:

- authorization headers;
- cookies;
- API keys;
- request bodies containing secrets;
- private repository source unnecessarily; or
- user email when user ID is sufficient.

See `docs/sentry-observability.md`.

## Incident response

If credential exposure is suspected:

1. contain the affected path;
2. rotate/revoke the exposed credential at the provider;
3. remove it from active application state and logs where possible;
4. verify Git history/artifacts/deploy logs for exposure;
5. add detection/regression coverage; and
6. document the root cause without reproducing the secret.

Do not paste replacement secrets into issues, PR comments, chat logs, or source code.
