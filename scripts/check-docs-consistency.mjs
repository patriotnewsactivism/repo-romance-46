import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/CLOUD_RUN_MIGRATION.md",
  "docs/PROJECT_STATE.md",
  "docs/DEFINITION_OF_DONE.md",
  "docs/REASONING_AND_LEARNING.md",
  "docs/AI_PROVIDERS.md",
  "docs/EXTERNAL_LLM_HANDOFFS.md",
  "docs/RELEASE-CHECKLIST.md",
  "docs/INCIDENT_RESPONSE.md",
  "docs/DECISIONS.md",
  "docs/GOVERNANCE.md",
];

const errors = [];

for (const path of requiredFiles) {
  if (!existsSync(path)) errors.push(`Missing canonical documentation file: ${path}`);
}

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function requireTokens(path, tokens) {
  const text = read(path);
  for (const token of tokens) {
    if (!text.includes(token)) {
      errors.push(`${path} is missing canonical topology/policy token: ${JSON.stringify(token)}`);
    }
  }
}

function forbidTokens(path, tokens) {
  const text = read(path);
  for (const token of tokens) {
    if (text.includes(token)) {
      errors.push(`${path} contains stale canonical topology text: ${JSON.stringify(token)}`);
    }
  }
}

const cloudRunTokens = [
  "repofinisher-web",
  "repofinisher-api",
  "repofinisher-completion-session",
];

for (const path of [
  "README.md",
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/CLOUD_RUN_MIGRATION.md",
  "docs/PROJECT_STATE.md",
  "docs/DECISIONS.md",
]) {
  requireTokens(path, cloudRunTokens);
}

requireTokens("README.md", ["Cloudflare", "Vercel is not an approved deployment target"]);
requireTokens("AGENTS.md", ["Cloudflare", "Never deploy RepoFinisher to Vercel"]);
requireTokens("SECURITY.md", ["Google Cloud Run", "Supabase Vault", "Vercel is not an approved deployment target"]);
requireTokens("docs/ARCHITECTURE.md", ["Cloudflare DNS", "Workload Identity Federation"]);
requireTokens("docs/OPERATIONS.md", ["Google Secret Manager", "Workload Identity Federation", "Cloudflare"]);
requireTokens("docs/DECISIONS.md", ["Production runtime is Google Cloud Run + Supabase + GitHub"]);
requireTokens("docs/PROJECT_STATE.md", ["Highest-priority remaining work", "Latest Cloud Run deployment evidence"]);
requireTokens("docs/RELEASE-CHECKLIST.md", ["Cloud Run API", "Cloud Run frontend", "Cloud Run completion-session Job"]);
requireTokens("docs/INCIDENT_RESPONSE.md", ["Cloud Run frontend diagnosis", "Cloud Run API diagnosis", "Cloud Run Job diagnosis"]);

const staleCanonicalPhrases = new Map([
  ["README.md", [
    "- **Frontend:** Netlify",
    "- **API:** `repofinisher-api-live` on Render",
    "Netlify serves only the SPA",
  ]],
  ["AGENTS.md", [
    "Production topology:\n\n```text\nNetlify frontend",
    "Render API (`repofinisher-api-live`)",
  ]],
  ["CONTRIBUTING.md", [
    "- Netlify frontend\n- Render API",
  ]],
  ["SECURITY.md", [
    "Security/deployment fixes must use Netlify, Render, Supabase, and GitHub",
  ]],
  ["docs/ARCHITECTURE.md", [
    "Netlify (React/Vite SPA)",
    "existing Render API remains the known-good rollback endpoint until Cloud Run",
  ]],
  ["docs/OPERATIONS.md", [
    "## Netlify frontend",
    "## Render API",
    "repofinisher-api-live",
  ]],
  ["docs/CLOUD_RUN_MIGRATION.md", [
    "## Netlify cutover",
    "Keep the existing Netlify frontend.",
    "Netlify production bundle calls Cloud Run",
  ]],
  ["docs/DECISIONS.md", [
    "Production hosting is Netlify + Cloud Run + Cloud Run Jobs",
  ]],
  ["docs/RELEASE-CHECKLIST.md", [
    "## Backend release — Render",
    "## Frontend release — Netlify",
  ]],
  ["docs/INCIDENT_RESPONSE.md", [
    "### Netlify frontend",
    "### Render API",
  ]],
]);

for (const [path, tokens] of staleCanonicalPhrases) forbidTokens(path, tokens);

// Legacy providers may be mentioned as migration/rollback history, but canonical
// documents must make that context explicit rather than silently presenting them
// as the active production topology.
for (const path of ["README.md", "AGENTS.md", "docs/ARCHITECTURE.md", "docs/OPERATIONS.md", "docs/DECISIONS.md"]) {
  const text = read(path);
  if (/\bNetlify\b|\bRender\b/.test(text) && !/legacy|former|rollback|histor|transitional|migration/i.test(text)) {
    errors.push(`${path} mentions Netlify/Render without an explicit legacy/migration/rollback context.`);
  }
}

if (errors.length) {
  console.error("Documentation consistency check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation consistency check passed (${requiredFiles.length} canonical files checked).`);
