# AGENTS.md — RepoFinisher Operating Rules

This file is the authoritative repository-level instruction set for AI coding agents, autonomous tools, and external LLMs working on RepoFinisher itself.

If a provider-specific file such as `CLAUDE.md`, `GEMINI.md`, or `QWEN.md` conflicts with this file, **AGENTS.md wins**.

## 1. Product intent

RepoFinisher is a production autonomous repository-completion operating system. Do not reduce it to a demo, generic chatbot, recommendation-only dashboard, or single-shot code generator.

The product must be able to:

- assess a repository from its actual current state;
- identify verified blockers, likely blockers, unknowns and root causes;
- reason using measured historical outcomes;
- create an exact bounded plan;
- execute approved work on an isolated branch;
- create draft PRs;
- verify CI and runtime/deployment evidence;
- self-heal eligible failures without weakening acceptance criteria;
- re-score the result;
- learn from measured outcomes; and
- generate detailed standalone completion handoffs for external coding agents without replacing RepoFinisher's own finishing capability.

## 2. Read before changing code

Before material changes, inspect:

1. `README.md`
2. this file
3. `docs/ARCHITECTURE.md`
4. `docs/OPERATIONS.md`
5. `docs/REASONING_AND_LEARNING.md` for reasoning/agent changes
6. `SECURITY.md` for auth, credentials, data or execution changes
7. `.env.example` for configuration boundaries
8. relevant migrations and tests

Do not rely on chat history as the source of truth when the repository can answer the question.

## 3. Production platform policy

Approved production architecture:

- **Netlify** — frontend SPA
- **Render** — persistent API and long-running work
- **Supabase** — Postgres/Auth/RLS/Vault
- **GitHub** — source, CI, branches, PRs and target-repo operations
- **Sentry** — observability when configured

### Vercel prohibition

Do not deploy RepoFinisher to Vercel. Do not add Vercel hosting configuration, Vercel API routes, Vercel build wrappers, Vercel deployment workflows, or a Vercel production origin.

If legacy Vercel-specific runtime dependencies remain, treat them as migration debt and prefer provider-neutral replacements. Do not expand their use.

## 4. Immutable safety policy

No agent or adaptive prompt may override these rules.

### Secrets and credentials

- Never commit API keys, access tokens, private keys, service-role keys or secrets.
- Never put private secrets in `VITE_*` variables.
- User AI BYOK credentials belong in Supabase Vault and must be read/write/delete capable only through trusted server-side service-role paths.
- Browser responses may expose only safe readiness metadata such as `key configured: true`, never credential values.
- GitHub credentials currently use server-side sealed storage. Preserve this boundary until a separately reviewed migration replaces it.
- Never print credentials into logs, traces, prompts, PR bodies, reasoning records, exceptions or test snapshots.

### Repository changes

- Never silently auto-merge RepoFinisher-generated PRs.
- Keep generated PRs draft unless product policy is explicitly and deliberately changed.
- Never execute an approved plan against a different base SHA.
- Never mutate a stored exact plan after its approval hash has been recorded.
- Never remove or weaken tests, CI, security controls, permissions, CODEOWNERS, `SECURITY.md`, approval gates or acceptance criteria merely to make a run pass.
- Never autonomously write credential-bearing paths.
- Never overwrite an existing license as part of autonomous finishing.

### Database

- Treat production migrations as append-only history.
- Never edit an already-applied migration to change production state. Add a forward migration.
- Prefer idempotent/defensive DDL where appropriate (`if exists` / `if not exists`) without hiding real schema drift.
- Preserve RLS and least-privilege access.
- Database/auth/payment/security changes require explicit verification evidence before a run can be described as production-ready.

### Claims and scoring

- Do not invent revenue, customer counts, TAM, market share, competition, adoption, deployment health or test success.
- Label estimates as estimates.
- A repository is not “finished” merely because code compiles or CI turns green.
- Do not describe prompt adaptation or operational memory as self-training of model weights.

## 5. Reasoning standard

For non-trivial finishing work, prefer this sequence:

1. collect repository evidence at an exact SHA;
2. load measured repo and cross-repo operational memory;
3. generate competing root-cause hypotheses;
4. run skeptical/falsification-oriented critique;
5. select only specialists justified by evidence;
6. synthesize the smallest ordered plan likely to pass real validation;
7. identify risks, unknowns and stop conditions;
8. generate code only after the plan is coherent;
9. verify actual checks/runtime behavior;
10. re-diagnose from new evidence when a repair fails;
11. record measured outcomes for future runs.

Do not substitute more tokens or more agents for better evidence.

## 6. Self-healing rules

Self-healing exists to fix root causes, not to game CI.

A repair attempt must:

- inspect the latest failure logs/check output;
- compare against prior failed repair attempts;
- avoid repeating an identical failed patch;
- form a root-cause diagnosis before writing;
- keep scope bounded;
- re-run validation after the repair; and
- stop when repair budget/attempt limits are exhausted or evidence is inadequate.

Protected during automatic repair:

- tests/specs;
- GitHub Actions workflows;
- CODEOWNERS;
- SECURITY.md;
- lockfiles;
- credential files;
- existing package `test`, `lint` and `typecheck` scripts.

## 7. External-agent handoffs

RepoFinisher may generate provider-neutral or provider-specific completion prompts for external coding agents.

Those handoffs must:

- identify the assessed repository and exact SHA;
- instruct the external agent to verify the SHA before acting;
- summarize evidence and accepted root causes;
- include remaining work in dependency order;
- include validation and stop conditions;
- distinguish verified facts from estimates/unknowns;
- require real tests/build/CI/runtime checks; and
- instruct iterative completion rather than “apply one patch and stop.”

They are a complement to the internal autonomous engine, not a fallback that excuses weaknesses in RepoFinisher itself.

## 8. Portfolio behavior

Portfolio analysis must not treat related repositories as automatically independent commercial products.

Consider and persist evidence for:

- duplicate or near-duplicate IP;
- shared packages/modules;
- frontend/backend pairs;
- worker/service relationships;
- successors/forks;
- merge candidates; and
- archive candidates.

Do not recommend destructive consolidation from similarity alone. High-impact merge/archive actions require repo-level verification.

## 9. Development workflow

Use pnpm only.

Before opening/merging a PR, run or obtain green evidence for:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

At minimum, GitHub Actions `CI` must pass. Production-facing changes should also pass the provider-neutral production smoke workflow when the relevant environment is deployed.

Use focused branches and PRs. Avoid mixing unrelated architecture rewrites into a bug fix unless the root cause genuinely requires it.

## 10. Documentation discipline

Update documentation in the same PR when a change alters:

- production hosting;
- environment variables;
- provider/model support;
- secret storage;
- database schema or migration procedure;
- reasoning/learning semantics;
- autonomy or approval behavior;
- CI/release procedures; or
- security boundaries.

Do not leave stale documentation that describes a superseded host or secret-storage model.

## 11. Stop conditions

Stop and surface the issue rather than guessing when:

- the repository tree is truncated/incomplete;
- required credentials are unavailable;
- the base SHA moved after approval;
- a migration's production application status is unknown and the change depends on it;
- validation cannot be observed;
- a repair would require weakening protected controls;
- repeated attempts produce no measurable improvement;
- a requested operation would expose a secret; or
- there is insufficient evidence for a destructive or high-risk action.

## 12. Definition of done for RepoFinisher changes

A change is not done until:

- implementation exists;
- relevant tests exist or a reason is documented;
- typecheck/build pass;
- migration state is handled if applicable;
- secret/security boundaries remain intact;
- deployment/runtime behavior is verified for production-impacting changes;
- documentation is updated; and
- the result does not falsely claim more verification than was actually performed.
