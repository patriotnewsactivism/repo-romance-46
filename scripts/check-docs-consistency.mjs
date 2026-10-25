import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/CONTABO_MIGRATION.md",
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
  const body = read(path);
  for (const token of tokens) {
    if (!body.includes(token)) {
      errors.push(`${path} is missing canonical topology/policy token: ${JSON.stringify(token)}`);
    }
  }
}

function forbidTokens(path, tokens) {
  // D002 and D001 are explicitly superseded decisions retained for audit.
  const body = path === "docs/DECISIONS.md" ? read(path).split("## D002 —")[0] : read(path);
  for (const token of tokens) {
    if (body.includes(token)) {
      errors.push(`${path} contains retired canonical topology text: ${JSON.stringify(token)}`);
    }
  }
}

const canonical = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/PROJECT_STATE.md",
  "docs/DECISIONS.md",
  "docs/RELEASE-CHECKLIST.md",
  "docs/INCIDENT_RESPONSE.md",
];

for (const path of canonical) {
  requireTokens(path, ["Vercel", "Contabo", "Supabase"]);
}

requireTokens("README.md", ["repofinisher-api", "repofinisher-worker"]);
requireTokens("AGENTS.md", ["REPOFINISHER_WORKER_MODE=persistent"]);
requireTokens("docs/ARCHITECTURE.md", ["persistent-worker.ts", "worker_token", "lease_expires_at"]);
requireTokens("docs/OPERATIONS.md", ["api.portfolio.donmatthews.live", "/api/healthz", "deploy/contabo/compose.yml"]);
requireTokens("docs/DECISIONS.md", ["D002", "superseded"]);
requireTokens("docs/PROJECT_STATE.md", ["2026-10-25", "Contabo"]);

const retiredPhrases = [
  "Vercel is not an approved deployment target",
  "Never deploy RepoFinisher to Vercel",
  "Production runtime is Google Cloud Run",
  "Canonical production is Cloud Run",
  "Current production source topology is Google Cloud Run",
  "https://repofinisher-api-production.up.railway.app",
  "REPOFINISHER_WORKER_MODE=railway-persistent",
];

for (const path of canonical) forbidTokens(path, retiredPhrases);

if (errors.length) {
  console.error("Documentation consistency check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation consistency check passed (${requiredFiles.length} canonical files checked).`);
