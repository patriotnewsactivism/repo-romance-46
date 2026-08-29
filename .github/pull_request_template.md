## Problem / evidence

Describe the verified problem, affected surface, and evidence. Distinguish facts from assumptions.

## Root cause

What is causing the problem? If root cause is not fully known, say so and describe the remaining uncertainty.

## Implementation

Summarize the smallest coherent change made and why it addresses the root cause.

## Verification

Check what was actually verified:

- [ ] package tests pass
- [ ] typecheck/build pass
- [ ] GitHub CI green
- [ ] Supabase migration applied/verified (if applicable)
- [ ] Render deployment healthy (if backend changed)
- [ ] Netlify deployment healthy (if frontend changed)
- [ ] production smoke passed (if material production change)
- [ ] authenticated user flow verified (if applicable)
- [ ] completion/readiness/outcome telemetry verified (if autonomous completion behavior changed)

Commands/evidence:

```text
# add relevant commands, workflow/deploy/run IDs, or concise evidence
```

## Security / autonomy impact

- Does this touch auth, RLS, Vault, secrets, CORS, permissions, repository writes, self-healing, approval gates, or merge authority?
- If yes, explain why boundaries remain safe.

## Database / deployment impact

List migrations, environment-variable changes, deployment ordering, domain/CORS changes, or `none`.

## Documentation

- [ ] relevant canonical docs updated
- [ ] `docs/PROJECT_STATE.md` updated if operational state changed
- [ ] no secret values included in docs/PR

## Known remaining work / risks

State unresolved blockers, follow-ups, limitations, or `none`.

## RepoFinisher policy checks

- [ ] no Vercel deployment/configuration reintroduced
- [ ] no tests/CI/security controls weakened merely to pass
- [ ] no secrets committed or exposed to `VITE_*`
- [ ] passing CI is not being represented as proof of full product completion without relevant runtime/product evidence
