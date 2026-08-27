/**
 * Deterministic synthetic repositories used by the test suite.
 * Excluded from the package build — this is test scaffolding, not product code.
 */

import { buildRepoIndex, type FetchedFile, type TreeEntry } from "./indexing";
import type { RepoIndex } from "./types";

export interface FixtureSpec {
  repo?: string;
  tree: TreeEntry[];
  files: FetchedFile[];
}

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

export function indexFixture(spec: FixtureSpec): RepoIndex {
  return buildRepoIndex({
    repo: spec.repo ?? "acme/widget",
    defaultBranch: "main",
    tree: spec.tree,
    files: spec.files,
    options: { now: FIXED_NOW },
  });
}

/** A small but genuinely finished Express API: routes, tests, CI, Docker, migrations. */
export function healthyApiFixture(): RepoIndex {
  const serverSource = `
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requireAuth } from "./middlewares/auth";
import { logger } from "./logger";

export const app = express();
app.use(helmet());
app.use(rateLimit({ windowMs: 60000, max: 100 }));

app.get("/health", (req, res) => { res.json({ ok: true }); });
app.get("/api/widgets", requireAuth, async (req, res) => {
  try {
    const rows = await listWidgets(process.env.DATABASE_URL);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "list failed");
    res.status(500).json({ error: "failed" });
  }
});
app.post("/api/widgets", requireAuth, async (req, res) => {
  const created = await createWidget(req.body);
  res.status(201).json(created);
});
app.patch("/api/widgets/:id", requireAuth, async (req, res) => { res.json(await updateWidget(req.params.id, req.body)); });
app.delete("/api/widgets/:id", requireAuth, async (req, res) => { res.json(await removeWidget(req.params.id)); });
app.get("/api/orgs", requireAuth, async (req, res) => { res.json(await listOrgs()); });
app.get("/api/account", requireAuth, async (req, res) => { res.json(await getAccount()); });
app.post("/api/subscription", requireAuth, async (req, res) => { res.json(await subscribe(req.body)); });

export async function listWidgets(url: string) {
  const db = await connect(url);
  return db.query("select * from widgets");
}
export async function createWidget(input: unknown) {
  const parsed = schema.parse(input);
  return db.insert(parsed);
}
export async function updateWidget(id: string, input: unknown) {
  return db.update(id, schema.parse(input));
}
export async function removeWidget(id: string) {
  return db.delete(id);
}
`;

  return indexFixture({
    tree: [
      { path: "package.json", type: "blob", size: 700 },
      { path: "pnpm-lock.yaml", type: "blob", size: 40000 },
      { path: "README.md", type: "blob", size: 2000 },
      { path: "LICENSE", type: "blob", size: 1000 },
      { path: "Dockerfile", type: "blob", size: 400 },
      { path: ".env.example", type: "blob", size: 200 },
      { path: ".github/workflows/ci.yml", type: "blob", size: 600 },
      { path: "docs/architecture.md", type: "blob", size: 3000 },
      { path: "docs/operations.md", type: "blob", size: 2000 },
      { path: "docs/api.md", type: "blob", size: 2000 },
      { path: "docs/security.md", type: "blob", size: 1500 },
      { path: "docs/onboarding.md", type: "blob", size: 1500 },
      { path: "openapi.yaml", type: "blob", size: 5000 },
      { path: "migrations/0001_init.sql", type: "blob", size: 900 },
      { path: "src/server.ts", type: "blob", size: 3000 },
      { path: "src/logger.ts", type: "blob", size: 300 },
      { path: "src/middlewares/auth.ts", type: "blob", size: 800 },
      { path: "src/db/schema.ts", type: "blob", size: 900 },
      { path: "src/server.test.ts", type: "blob", size: 1200 },
      { path: "src/db/schema.test.ts", type: "blob", size: 800 },
      { path: "node_modules/left-pad/index.js", type: "blob", size: 100 },
    ],
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "widget-api",
          scripts: { build: "tsc", start: "node dist/server.js", test: "vitest run", typecheck: "tsc --noEmit" },
          dependencies: {
            express: "^5.0.0",
            helmet: "^8.0.0",
            "express-rate-limit": "^7.0.0",
            pino: "^9.0.0",
            "drizzle-orm": "^0.45.0",
            jsonwebtoken: "^9.0.0",
          },
          devDependencies: { vitest: "^3.0.0", typescript: "^5.9.0" },
        }),
      },
      { path: "src/server.ts", content: serverSource },
      { path: "src/logger.ts", content: `import pino from "pino";\nexport const logger = pino();\n` },
      {
        path: "src/middlewares/auth.ts",
        content: `export function requireAuth(req, res, next) {\n  const token = req.headers.authorization;\n  if (!token) { res.status(401).json({ error: "no" }); return; }\n  next();\n}\n`,
      },
      {
        path: "src/db/schema.ts",
        content: `export const widgets = table("widgets", {});\nexport const orgs = table("orgs", {});\nexport const users = table("users", {});\n`,
      },
      { path: "src/server.test.ts", content: `it("responds", async () => { expect(1).toBe(1); });\n` },
      { path: "src/db/schema.test.ts", content: `it("has tables", () => { expect(widgets).toBeDefined(); });\n` },
    ],
  });
}

/** An abandoned scaffold: stubs everywhere, no tests, no CI, no deployment. */
export function abandonedScaffoldFixture(): RepoIndex {
  const stubbed = `
// TODO: implement everything below
export function loadUser() {}
export function saveUser() {}
export function deleteUser() { throw new Error("not implemented"); }
const helper = () => null;
// FIXME: this whole module is a placeholder implementation
export function render() {}
`;
  return indexFixture({
    repo: "acme/abandoned",
    tree: [
      { path: "package.json", type: "blob", size: 300 },
      { path: "src/index.ts", type: "blob", size: 500 },
      { path: "src/users.ts", type: "blob", size: 500 },
      { path: "src/render.ts", type: "blob", size: 500 },
      { path: "src/util.ts", type: "blob", size: 500 },
      { path: "src/api.ts", type: "blob", size: 500 },
      { path: "src/store.ts", type: "blob", size: 500 },
    ],
    files: [
      { path: "package.json", content: JSON.stringify({ name: "abandoned", dependencies: {} }) },
      { path: "src/index.ts", content: stubbed },
      { path: "src/users.ts", content: stubbed },
      { path: "src/render.ts", content: stubbed },
      { path: "src/util.ts", content: stubbed },
      { path: "src/api.ts", content: stubbed },
      { path: "src/store.ts", content: stubbed },
    ],
  });
}

/** A published library: real exports, thorough tests, no app surface at all. */
export function libraryFixture(): RepoIndex {
  const lib = `
export function parse(input: string) {
  return input.split(",").map((s) => s.trim());
}
export function format(parts: string[]) {
  return parts.join(", ");
}
export function validate(parts: string[]) {
  if (parts.length === 0) throw new Error("empty");
  return true;
}
export const VERSION = "1.0.0";
`;
  return indexFixture({
    repo: "acme/parsekit",
    tree: [
      { path: "package.json", type: "blob", size: 400 },
      { path: "pnpm-lock.yaml", type: "blob", size: 20000 },
      { path: "README.md", type: "blob", size: 4000 },
      { path: "LICENSE", type: "blob", size: 1000 },
      { path: ".env.example", type: "blob", size: 50 },
      { path: ".github/workflows/ci.yml", type: "blob", size: 500 },
      { path: "docs/usage.md", type: "blob", size: 1000 },
      { path: "docs/api.md", type: "blob", size: 1000 },
      { path: "docs/faq.md", type: "blob", size: 800 },
      { path: "docs/changelog.md", type: "blob", size: 900 },
      { path: "docs/contributing.md", type: "blob", size: 700 },
      { path: "src/index.ts", type: "blob", size: 900 },
      { path: "src/index.test.ts", type: "blob", size: 900 },
    ],
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "parsekit",
          scripts: { build: "tsc", test: "vitest run", typecheck: "tsc --noEmit" },
          dependencies: {},
          devDependencies: { vitest: "^3.0.0", typescript: "^5.9.0" },
        }),
      },
      { path: "src/index.ts", content: lib },
      { path: "src/index.test.ts", content: `it("parses", () => { expect(parse("a,b")).toEqual(["a","b"]); });\n` },
    ],
  });
}
