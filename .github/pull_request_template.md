## Problem / evidence

Describe the verified problem, affected surface, and evidence. Distinguish facts from assumptions.

## Root cause

What is causing the problem? If root cause is not fully known, say so and describe the uncertainty.

## Implementation

Summarize the smallest coherent change and why it addresses the root cause.

## Verification

Check only what was actually verified:

- [ ] package tests pass
- [ ] typecheck/build pass
- [ ] documentation consistency guard passes
- [ ] GitHub CI green
- [ ] Supabase migration applied/verified (if applicable)
- [ ] Cloud Run API direct health verified (if backend changed)
- [ ] Cloud Run frontend direct health verified (if frontend changed)
- [ ] Cloud Run completion-session Job deployed/exercised (if worker changed)
- [ ] runtime environment/Secret Manager contract verified (if applicable)
- [ ] canonical custom domain/Cloudflare DNS verified (if affected)
- [ ] production smoke passed (if material production change)
- [ ] authenticated user flow verified (if applicable)
- [ ] completion/readiness/outcome telemetry verified (if autonomous behavior changed)

Commands/evidence:

```text
# workflow/run/revision/job IDs and concise evidence
```

## Security / autonomy impact

- Does this touch auth, RLS, Vault, secrets, CORS, IAM, Cloud Run Jobs, repository writes, self-healing, approval gates, or merge authority?
- If yes, explain why boundaries remain safe.

## Database / deployment impact

List migrations, environment-variable changes, Secret Manager changes, Cloud Run service/job changes, domain/DNS changes, deployment ordering, or `none`.

## Documentation

- [ ] relevant canonical docs updated
- [ ] `docs/PROJECT_STATE.md` updated if operational state changed
- [ ] durable architecture decision added/updated if applicable
- [ ] no secret values included in docs/PR

## Known remaining work / risks

State unresolved blockers, follow-ups, limitations, or `none`.

## RepoFinisher policy checks

- [ ] no Vercel deployment/configuration reintroduced
- [ ] no long-lived Google service-account JSON key introduced
- [ ] no tests/CI/security controls weakened merely to pass
- [ ] no secrets committed or exposed to `VITE_*`
- [ ] no worker retry can replay completed repository writes
- [ ] passing CI is not represented as proof of full product completion without relevant runtime/product evidence
- [ ] `merged`, `deployed`, `direct runtime verified`, `canonical domain verified`, and `user-flow verified` are reported distinctly