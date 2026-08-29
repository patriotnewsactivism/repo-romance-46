# Incident Response Runbook

Use this runbook when RepoFinisher production behavior is unavailable, unsafe, serving stale code, failing authenticated requests, exposing a security concern, or producing unreliable autonomous completion results.

## Severity guide

**SEV-1 — Security/data/control risk**

Examples: exposed credential, authorization/RLS bypass, unexpected repository writes, corrupted production data, autonomous merge/write outside approved scope.

**SEV-2 — Production unavailable or core workflow broken**

Examples: frontend unavailable, API unavailable, authentication broken, Settings cannot persist required provider credentials, repository finishing cannot execute.

**SEV-3 — Degraded capability**

Examples: one AI provider unavailable, portfolio run degraded while direct finishing works, observability gaps, non-critical UI regression.

## First actions

1. Stop further destructive/high-autonomy actions if safety is uncertain.
2. Preserve evidence: timestamps, commit SHA, deployment ID, affected route/run ID, redacted error/log evidence.
3. Determine which seam is failing: Netlify, Render, Supabase, GitHub, AI provider, or application logic.
4. Do not rotate/delete credentials or production data until the affected dependency is understood unless active exposure requires immediate rotation.
5. Record what is known vs inferred.

## Hosting diagnosis

### Netlify frontend

Check:

- current deploy corresponds to `main`,
- intended custom domain,
- HTTPS/certificate,
- `VITE_API_BASE_URL`,
- Supabase browser variables,
- static SPA routing,
- browser console/network errors.

A broken frontend must not be "fixed" by falling back to Vercel. Vercel is not an approved target.

### Render API

Check:

- `repofinisher-api-live` service state,
- current deployed commit,
- build/start logs,
- health endpoint,
- memory/CPU/latency if workload-related,
- required backend environment variables,
- CORS for the actual frontend origin.

Do not route long-running agent work into a short-lived frontend function as an outage workaround.

### Supabase

Check:

- project availability,
- auth/session failures,
- expected migration state,
- RLS/policies,
- service-role-only RPC permissions,
- Vault functions/references for BYOK,
- database errors/constraint failures.

Never disable RLS broadly to make an incident disappear.

## AI provider/BYOK incident

If keys/models cannot save or run:

1. Verify frontend request is going to Render.
2. Verify bearer token/session.
3. Separate persistence failure from provider invocation failure.
4. Verify provider/model contract.
5. Verify service-role Vault RPC access.
6. Verify preference row references a Vault secret when configured.
7. Confirm the API response/log does not include key material.
8. For quota/provider outage, preserve the stored key and report the provider-specific condition instead of erasing configuration.

## Autonomous completion incident

If RepoFinisher generated unsafe/wrong/repeated work:

1. Stop the affected run/session/portfolio item where possible.
2. Preserve plan hash, base SHA, branch, PR, reasoning trace, repair attempts, CI evidence, and outcome telemetry.
3. Determine whether the problem was evidence collection, diagnosis, planning, coding, validation, or repair.
4. Do not weaken tests/checks to complete the run.
5. If the same failed patch/strategy repeated, treat it as a learning-system defect.
6. Correct operational memory/prompt strategy only through measured evidence; never mutate immutable safety policy to recover.
7. Keep unrelated repositories isolated from the failed repository's rollback boundary.

## Suspected secret exposure

1. Remove the value from active logs/UI immediately where possible.
2. Rotate/revoke the exposed credential at its provider.
3. Search repository/history/logs/issues/PRs for additional exposure.
4. Replace the production secret with the rotated value in the correct backend secret store.
5. Do not consider deletion from the latest Git commit sufficient if the secret entered Git history.
6. Document the root cause and add a prevention test/control when practical.

## Deployment rollback

Prefer reverting to a known-good application deployment/commit over making several speculative production edits.

Before rollback, identify whether a database migration makes an application-only rollback incompatible. Forward corrective migrations are preferred over destructive database rollback.

DNS changes should be a last-stage cutover step, not the first response to a build failure.

## Communication/status language

Use precise states:

- code fixed,
- PR merged,
- migration applied,
- deploy healthy,
- runtime route verified,
- authenticated user flow verified.

Do not collapse these into "fixed" if later layers remain unverified.

## Closure criteria

An incident is closed only when:

- immediate impact is contained,
- root cause is known to a reasonable confidence,
- production behavior is verified,
- security/data concerns are resolved,
- regression prevention is added where practical,
- docs/project state are updated when architecture or operating assumptions changed,
- any autonomous-learning impact is recorded so the same failure is less likely to recur.