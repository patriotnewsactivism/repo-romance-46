## Problem / verified root cause

<!-- What is actually wrong? Separate verified evidence from inference. -->

## Implementation

<!-- What changed and why is this the smallest correct change? -->

## Scope / affected surfaces

- [ ] Frontend
- [ ] API / backend
- [ ] Database / Supabase migration
- [ ] AI provider / reasoning / learning
- [ ] Autonomous repository writes
- [ ] CI / self-healing / deployment verification
- [ ] Hosting / DNS / environment variables
- [ ] Security / auth / RLS / Vault
- [ ] Documentation only

## Verification

Record what was actually run or observed. Do not check a box based on expectation.

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] GitHub CI green
- [ ] Required Supabase migration applied and verified
- [ ] Render API deployment healthy when backend changed
- [ ] Netlify deployment healthy when frontend changed
- [ ] Production smoke passed when production seams changed
- [ ] Relevant authenticated/core user journey verified
- [ ] Mobile/desktop UI verified when UI changed

## Security / autonomy review

- [ ] No secrets were committed, logged, or placed in `VITE_*` variables
- [ ] RLS/auth/permission boundaries were not weakened
- [ ] Exact-plan/base-SHA approval and stale-base protections remain intact where applicable
- [ ] Tests/CI/security acceptance criteria were not weakened merely to obtain a pass
- [ ] Automatic merge authority was not added or expanded unintentionally
- [ ] New service-role/Vault operations are least-privilege and backend-only

## Database / migration notes

<!-- Migration ordering, data transformation, grants/RLS, rollback/irreversibility. Write "None" if not applicable. -->

## Deployment / rollback notes

<!-- Target host, environment changes, domain/DNS impact, rollback path. Vercel is not an approved RepoFinisher target. -->

## Learning / completion impact

<!-- If this changes autonomous completion, explain outcome telemetry, reasoning/learning behavior, repair limits, and how success will be measured. -->

## Documentation updated

- [ ] `README.md` / `AGENTS.md` if repository-wide behavior changed
- [ ] `docs/PROJECT_STATE.md` if current operational status changed
- [ ] `docs/DECISIONS.md` if a durable architecture/product decision changed
- [ ] `docs/OPERATIONS.md` / `.env.example` if deployment/config changed
- [ ] `SECURITY.md` if the security model changed
- [ ] `docs/DEFINITION_OF_DONE.md` if completion criteria changed
- [ ] Documentation update not required; reason stated below

## Known remaining work / limitations

<!-- Do not hide known gaps. If none, say none. -->

## Definition of Done

- [ ] This PR does not claim more completion than the evidence supports
- [ ] Applicable gates in `docs/DEFINITION_OF_DONE.md` are satisfied or explicitly listed as remaining work
