// Vercel Function wrapper around the API bundle produced during `vercel build`.
// maxDuration: this team's Pro plan has Fluid Compute enabled (800s cap).
// Multi-stage portfolio analysis (profiling, digesting, AI batches, critique,
// final synthesis) genuinely needs several minutes for larger portfolios —
// 500s was cutting real, in-progress analyses off mid-run. Raised to 750s,
// leaving margin under the platform cap; see SAFE_BUDGET_MS in
// routes/analysis.ts for the matching internal guard.
export const config = { maxDuration: 750 };
export { default } from "../artifacts/api-server/dist/vercel-function/vercel.mjs";
