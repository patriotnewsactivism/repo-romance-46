# Historical Cloud Run Migration Record

**Status:** retired / superseded on 2026-09-19.

RepoFinisher no longer uses Google Cloud Run or Cloud Run Jobs as its canonical production runtime.

Current architecture is documented in:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/PROJECT_STATE.md`
- `docs/RAILWAY_MIGRATION.md`
- `docs/DECISIONS.md`

The previous Cloud Run topology used a frontend service, an API service, and a completion-session Job. That design was replaced with:

- Vercel frontend;
- Railway persistent API;
- Railway persistent worker;
- Supabase auth/data/durable state.

Any remaining Cloud Run workflow, Docker, infrastructure, domain, or environment references should be treated as migration cleanup candidates rather than active production instructions.
