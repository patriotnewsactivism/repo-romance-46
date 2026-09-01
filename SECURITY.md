# Security Policy

RepoFinisher handles source-code access, repository write authority, AI provider credentials, user-owned analysis data, and autonomous execution state. Security failures can affect both RepoFinisher and repositories it is authorized to modify.

## Reporting a vulnerability

Do not post active credentials, private keys, tokens, exploit details, or sensitive user data in a public GitHub issue.

Preferred path:

1. Use GitHub private vulnerability reporting if enabled.
2. Otherwise contact the repository maintainer through a private channel and provide only the minimum details needed to establish a secure follow-up path.

Public issues are appropriate for non-sensitive hardening suggestions after secret/exploit material has been removed.

## Secret-handling policy

Never commit, log, or expose:

- Supabase trusted backend/service-role keys;
- GitHub access tokens;
- AI provider API keys;
- Google/other cloud private keys or service-account credential JSON;
- private keys/certificates;
- Sentry auth tokens;
- `PLAN_SIGNING_SECRET`;
- `SECRET_ENCRYPTION_KEY`;
- session/access tokens;
- Cloudflare API tokens.

Anything prefixed `VITE_` is browser-visible. A secret must never be moved into `VITE_*` to solve configuration/deployment problems.

Supabase publishable/anon browser keys are public client credentials by design; RLS/auth policy remains the authorization boundary. Do not misclassify them as backend secrets, but do not use them as a substitute for trusted backend credentials either.

## AI BYOK credentials

New user-supplied AI provider credentials are stored through Supabase Vault.

Requirements:

- browser/authenticated clients never receive decrypted provider keys;
- ordinary browser roles cannot execute privileged Vault store/read/delete RPCs;
- trusted backend code performs Vault operations;
- application responses expose only safe provider/model/configured metadata;
- provider keys are redacted from logs/errors;
- switching providers must not silently reuse another provider's credential.

The historical `custom_ai_key` path is compatibility-only and is not the destination for new plaintext credentials.

## GitHub credentials

Stored GitHub credentials use server-side secret sealing.

`SECRET_ENCRYPTION_KEY` is backend-only. If a host/key migration makes an old envelope unreadable, treat that credential as unavailable and require reconnection rather than crashing unrelated authenticated features or exposing ciphertext/plaintext.

## Supabase trusted backend key

`SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY` is backend-only and bypasses normal RLS assumptions. It must be available only to trusted backend execution that needs it.

Any new privileged operation must be narrowly scoped and reviewed for cross-user access.

## Google Cloud identity and secret storage

Production deployment/runtime uses Google Cloud Run, Cloud Run Jobs, Artifact Registry, and Secret Manager.

Security requirements:

- GitHub Actions authenticates through OIDC + Workload Identity Federation;
- do not create a long-lived Google service-account JSON key for CI;
- deployment and runtime service accounts remain separate and least-privilege;
- backend compute secrets come from Google Secret Manager rather than workflow literals/image layers;
- the runtime identity receives only the access it needs, including specific Job invocation and required secret reads;
- Cloud Run Job overrides contain only minimal non-secret identifiers;
- immutable image provenance remains traceable to the Git commit SHA.

## Cloudflare DNS

The deployment workflow may update DNS for `portfolio.donmatthews.live` through a Cloudflare API token stored in GitHub secrets.

Do not log the token. Domain/DNS changes occur only after direct Cloud Run surfaces are healthy. Never delete working DNS before the replacement mapping has emitted valid records.

## RLS and authorization

User-owned tables must use Row Level Security unless there is a documented server-only reason not to.

Do not solve application errors by disabling RLS or broadly granting access.

When adding a table/function:

- define ownership model;
- add least-privilege policies;
- explicitly review browser and trusted backend access;
- verify permissions after migration.

## Repository write safety

RepoFinisher's repository-write path must retain:

- exact-plan hash/signature binding;
- base SHA binding;
- stale-base rejection;
- safe path/content validation;
- protected-file rules;
- isolated branch creation;
- draft PR boundary;
- verification before success;
- no-auto-merge default.

Do not bypass these controls because an agent is confident.

## Worker/retry safety

Long-running completion workers use durable Supabase session state, leases, and heartbeats.

A Cloud Run Job retry/re-dispatch must resume existing durable state. It must not replay completed branch writes, create duplicate PR work, or reset approval boundaries merely because a process restarted.

Job environment overrides must not carry GitHub tokens, provider credentials, raw repository code, or other secrets.

## Self-healing safety

Self-healing fixes implementation defects, not acceptance criteria.

Automatic repair must not weaken/delete/skip tests, remove checks, alter security governance merely to pass, expose secrets, or repeat an identical known-failed patch unchanged.

Low-confidence repairs should stop and surface the blocker.

## SSRF and network access

Any server-side URL probe/deployment verification must defend against SSRF.

At minimum:

- restrict schemes;
- reject embedded credentials/unexpected ports;
- prevent private/loopback/link-local targets;
- control redirects;
- prefer allowlisted hosted-preview providers where practical;
- bound request time/response handling.

## CORS

Production authenticated API access must use explicit first-party origins. Do not replace production CORS with `*` to work around a frontend/domain migration.

The canonical browser origin is `https://portfolio.donmatthews.live`; direct Cloud Run origins may be allowed only when deliberately required for verification/operations.

## Dependency and workflow security

Generated CI/workflows must not introduce broad write-all permissions, secret-exposing triggers, or other privileged constructs without explicit manual review.

Dependency upgrades require runtime/security review; automated provenance alone is insufficient.

## Database migrations

Migrations are production code.

Review:

- destructive operations;
- RLS/policy changes;
- grants/revokes;
- `security definer` functions;
- search paths;
- data transformations;
- secret migration behavior;
- trusted-backend-only functions.

## Logging and observability

Logs/traces/events must not contain secret values.

CI failure evidence and external logs should be redacted before being sent to an LLM where feasible.

Safe metadata includes provider/model, configured/not-configured state, status code, redacted error class, opaque secret identifiers when needed, commit SHA, revision/job/run IDs, and non-secret deployment metadata.

## Hosting policy

Canonical production runtime is Google Cloud Run/Cloud Run Jobs with Supabase, GitHub/GitHub Actions, Artifact Registry, Secret Manager, and Cloudflare DNS as described in the architecture docs.

**Vercel is not an approved deployment target. Never use it as an outage fallback.**

Former Netlify/Render assets are legacy rollback/migration artifacts and must not be silently reactivated. Any emergency rollback to them requires explicit verification that they are still secure/current and must be recorded in project state.

Do not add an unreviewed hosting provider or third-party secret store merely to bypass an outage.

## Security changes and CI

Security-sensitive changes should be isolated in focused PRs when practical and must not be merged around failing required checks.

Update this file, `AGENTS.md`, and relevant architecture/operations documentation whenever the security model materially changes.