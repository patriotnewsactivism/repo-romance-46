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
- [ ] Vercel frontend deployment verified (if frontend changed)
- [ ] Railway API health verified (if backend changed)
- [ ] Railway worker deployed/exercised (if worker changed)
- [ ] runtime environment contract verified (if applicable)
- [ ] canonical frontend/API DNS verified (if affected)
- [ ] production smoke passed (if material production change)
- [ ] authenticated user flow verified (if applicable)
- [ ] completion/readiness/outcome telemetry verified (if autonomous behavior changed)

Commands/evidence:

```text
# workflow/deployment/service IDs and concise evidence
```

## Security / autonomy impact

- Does this touch auth, RLS, Vault, secrets, CORS, Railway worker execution, repository writes, self-healing, approval gates, or merge authority?
- If yes, explain why boundaries remain safe.

## Database / deployment impact

List migrations, environment-variable changes, Vercel/Railway service changes, domain/DNS changes, deployment ordering, or `none`.

## Documentation

- [ ] relevant canonical docs updated
- [ ] `docs/PROJECT_STATE.md` updated if operational state changed
- [ ] durable architecture decision added/updated if applicable
- [ ] no secret values included in docs/PR

## Known remaining work / risks

State unresolved blockers, follow-ups, limitations, or `none`.

## RepoFinisher policy checks

- [ ] Vercel remains the frontend target
- [ ] Railway remains the API/worker target
- [ ] no automatic Cloud Run deployment workflow reintroduced
- [ ] no tests/CI/security controls weakened merely to pass
- [ ] no secrets committed or exposed to `VITE_*`
- [ ] no worker retry can replay completed repository writes
- [ ] passing CI is not represented as proof of full product completion without relevant runtime/product evidence
- [ ] `merged`, `deployed`, `runtime verified`, `domain verified`, and `user-flow verified` are reported distinctly
