/**
 * Bounded, hierarchical repository ingestion.
 *
 * The pipeline is: tree → file classification → prioritized selection →
 * content analysis → module graph → repository signals. Only the selected
 * slice of files is ever read, so indexing a 50k-file monorepo costs the same
 * as indexing a 200-file app. Nothing here calls an LLM; an LLM's job is to
 * reason over the `RepoIndex` this produces, not to rebuild it.
 */

import {
  countFunctions,
  detectStubs,
  extractApiRoutes,
  extractEnvRefs,
  extractExports,
  extractFrontendRoutes,
  extractImports,
} from "./static-analysis";
import type { DependencyRef, FileRole, IndexedFile, ModuleNode, RepoIndex, RepoSignals, StubHit } from "./types";

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface FetchedFile {
  path: string;
  content: string;
}

export interface IndexOptions {
  /** Hard cap on how many files have their contents read. */
  maxAnalyzedFiles?: number;
  /** Files larger than this are classified but never read. */
  maxFileBytes?: number;
  /** Overrides `new Date()` so indexing is reproducible in tests. */
  now?: Date;
}

const DEFAULT_MAX_ANALYZED_FILES = 60;
const DEFAULT_MAX_FILE_BYTES = 200_000;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  cs: "C#",
  php: "PHP",
  ex: "Elixir",
  exs: "Elixir",
  sql: "SQL",
  sh: "Shell",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  vue: "Vue",
  svelte: "Svelte",
  md: "Markdown",
  yml: "YAML",
  yaml: "YAML",
  json: "JSON",
  toml: "TOML",
};

const VENDOR_DIRS = ["node_modules/", "dist/", "build/", "vendor/", ".next/", "out/", "coverage/", ".venv/"];

export function languageOf(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || ext === path.toLowerCase()) return null;
  return LANGUAGE_BY_EXT[ext] ?? null;
}

export function isVendored(path: string): boolean {
  return VENDOR_DIRS.some((dir) => path.startsWith(dir) || path.includes(`/${dir}`));
}

export function classifyFileRole(path: string): FileRole {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|cargo\.lock|gemfile\.lock)$/.test(lower)) {
    return "lockfile";
  }
  if (lower.startsWith(".github/workflows/") || /(^|\/)(\.gitlab-ci\.yml|\.circleci\/)/.test(lower)) return "ci";
  if (/(^|\/)(dockerfile|docker-compose|fly\.toml|render\.yaml|vercel\.json|netlify\.toml|firebase\.json|app\.yaml|cloudbuild\.yaml|serverless\.yml|k8s\/|helm\/|terraform\/|\.tf$)/.test(lower)) {
    return "infra";
  }
  if (/(^|\/)migrations?\//.test(lower) || /\.(sql)$/.test(lower)) return "migration";
  if (/(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod|gemfile|composer\.json|setup\.py|requirements[^/]*\.txt)$/.test(lower)) {
    return "manifest";
  }
  if (/\.(test|spec)\.[a-z]+$/.test(base) || /(^|\/)(__tests__|tests?)\//.test(lower) || /(^|\/)test_[^/]+\.py$/.test(lower)) {
    return "test";
  }
  if (/\.(md|mdx|rst|txt|adoc)$/.test(lower)) return "docs";
  if (/(^|\/)(\.generated|generated)\//.test(lower) || /\.(gen|generated)\.[a-z]+$/.test(base)) return "generated";
  if (/\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|pdf)$/.test(lower)) return "asset";
  if (/(^|\/)(tsconfig[^/]*\.json|vite\.config\.[a-z]+|next\.config\.[a-z]+|drizzle\.config\.[a-z]+|\.eslintrc[^/]*|eslint\.config\.[a-z]+|\.prettierrc[^/]*|tailwind\.config\.[a-z]+|babel\.config\.[a-z]+|jest\.config\.[a-z]+|vitest\.config\.[a-z]+|\.env\.example|\.env\.sample|\.gitignore|\.npmrc|pnpm-workspace\.yaml)$/.test(lower)) {
    return "config";
  }
  if (languageOf(path)) return "source";
  return "other";
}

/** Files worth reading, most informative first. Deterministic for a given tree. */
export function selectFilesToAnalyze(tree: TreeEntry[], options: IndexOptions = {}): string[] {
  const maxFiles = options.maxAnalyzedFiles ?? DEFAULT_MAX_ANALYZED_FILES;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const blobs = tree.filter((t) => t.type === "blob" && !isVendored(t.path) && (t.size ?? 0) <= maxBytes);

  const rank = (path: string): number => {
    const role = classifyFileRole(path);
    const lower = path.toLowerCase();
    if (role === "manifest") return 0;
    if (/^readme/i.test(path.split("/").pop() ?? "")) return 1;
    if (role === "ci") return 2;
    if (role === "infra") return 3;
    if (role === "config") return 4;
    if (role === "migration") return 5;
    // Entry points and route/server code carry the most architectural signal
    if (/(^|\/)(src\/)?(index|main|app|server|cli|routes?)\.[a-z]+$/.test(lower)) return 6;
    if (/(^|\/)(routes?|pages|api|controllers|handlers)\//.test(lower) && role === "source") return 7;
    if (role === "source") return 8;
    if (role === "test") return 9;
    if (role === "docs") return 10;
    return 11;
  };

  return blobs
    .map((entry) => ({ entry, rank: rank(entry.path), depth: entry.path.split("/").length }))
    .sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.entry.path.localeCompare(b.entry.path))
    .slice(0, maxFiles)
    .map((x) => x.entry.path);
}

function moduleIdOf(path: string): string {
  const parts = path.split("/");
  return parts.length <= 1 ? "." : parts.slice(0, -1).join("/");
}

interface ParsedManifest {
  dependencies: DependencyRef[];
  scripts: Record<string, string>;
}

export function parsePackageManifest(content: string): ParsedManifest {
  const empty: ParsedManifest = { dependencies: [], scripts: {} };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return empty;
  }

  const collect = (field: string, kind: DependencyRef["kind"]): DependencyRef[] => {
    const block = json[field];
    if (!block || typeof block !== "object") return [];
    return Object.entries(block as Record<string, string>).map(([name, range]) => ({
      name,
      range: String(range),
      kind,
    }));
  };

  const scriptsBlock = json["scripts"];
  const scripts =
    scriptsBlock && typeof scriptsBlock === "object"
      ? Object.fromEntries(Object.entries(scriptsBlock as Record<string, string>).map(([k, v]) => [k, String(v)]))
      : {};

  return {
    dependencies: [
      ...collect("dependencies", "prod"),
      ...collect("devDependencies", "dev"),
      ...collect("peerDependencies", "peer"),
    ],
    scripts,
  };
}

const TEST_FRAMEWORKS = ["vitest", "jest", "mocha", "ava", "jasmine", "pytest", "@playwright/test", "cypress", "tap"];
const OBSERVABILITY_PACKAGES = ["@sentry/node", "@sentry/react", "@sentry/browser", "pino", "winston", "@opentelemetry/api", "datadog-metrics"];
const AUTH_PACKAGES = ["passport", "jsonwebtoken", "jose", "next-auth", "@supabase/supabase-js", "@clerk/clerk-sdk-node", "lucia"];
const RATE_LIMIT_PACKAGES = ["express-rate-limit", "rate-limiter-flexible", "@upstash/ratelimit", "koa-ratelimit"];

export function buildRepoIndex(input: {
  repo: string;
  defaultBranch: string;
  tree: TreeEntry[];
  files: FetchedFile[];
  options?: IndexOptions;
}): RepoIndex {
  const options = input.options ?? {};
  const maxFiles = options.maxAnalyzedFiles ?? DEFAULT_MAX_ANALYZED_FILES;
  const now = options.now ?? new Date();

  const blobs = input.tree.filter((t) => t.type === "blob" && !isVendored(t.path));
  const analyzedPaths = new Set(input.files.map((f) => f.path));
  const contentByPath = new Map(input.files.map((f) => [f.path, f.content]));

  const files: IndexedFile[] = blobs
    .map((entry) => ({
      path: entry.path,
      size: entry.size ?? 0,
      language: languageOf(entry.path),
      role: classifyFileRole(entry.path),
      analyzed: analyzedPaths.has(entry.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // ── Module graph ────────────────────────────────────────────────────────
  const moduleMap = new Map<string, ModuleNode>();
  const stubs: StubHit[] = [];
  const envVarRefs = new Set<string>();
  const apiRoutes = new Set<string>();
  const frontendRoutes = new Set<string>();
  const dependencies: DependencyRef[] = [];
  const scripts: Record<string, string> = {};

  let totalFunctions = 0;
  let stubbedFunctions = 0;

  for (const file of files) {
    const content = contentByPath.get(file.path);
    if (content === undefined) continue;

    if (file.role === "manifest" && file.path.endsWith("package.json")) {
      const parsed = parsePackageManifest(content);
      dependencies.push(...parsed.dependencies);
      Object.assign(scripts, parsed.scripts);
      continue;
    }

    if (file.role !== "source" && file.role !== "test") continue;

    const id = moduleIdOf(file.path);
    let node = moduleMap.get(id);
    if (!node) {
      node = {
        id,
        language: file.language,
        files: [],
        imports: [],
        externalDeps: [],
        exports: [],
        functionCount: 0,
        stubbedFunctionCount: 0,
        stubMarkers: 0,
      };
      moduleMap.set(id, node);
    }

    node.files.push(file.path);

    const fileStubs = detectStubs(content, file.path);
    stubs.push(...fileStubs);
    node.stubMarkers += fileStubs.length;

    for (const name of extractEnvRefs(content)) envVarRefs.add(name);
    for (const route of extractApiRoutes(content)) apiRoutes.add(route);
    for (const route of extractFrontendRoutes(content)) frontendRoutes.add(route);

    if (file.role === "source") {
      const counts = countFunctions(content);
      totalFunctions += counts.total;
      stubbedFunctions += counts.stubbed;
      node.functionCount += counts.total;
      node.stubbedFunctionCount += counts.stubbed;

      const { internal, external } = extractImports(content);
      for (const spec of internal) {
        const resolved = resolveInternalImport(id, spec);
        if (resolved && resolved !== id && !node.imports.includes(resolved)) node.imports.push(resolved);
      }
      for (const dep of external) if (!node.externalDeps.includes(dep)) node.externalDeps.push(dep);
      for (const name of extractExports(content)) if (!node.exports.includes(name)) node.exports.push(name);
    }
  }

  const modules = [...moduleMap.values()]
    .map((m) => ({
      ...m,
      files: m.files.sort(),
      imports: m.imports.sort(),
      externalDeps: m.externalDeps.sort(),
      exports: m.exports.sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // ── Signals ─────────────────────────────────────────────────────────────
  const depNames = new Set(dependencies.map((d) => d.name));
  const has = (predicate: (path: string) => boolean) => files.some((f) => predicate(f.path.toLowerCase()));
  const sourceFiles = files.filter((f) => f.role === "source");
  const testFiles = files.filter((f) => f.role === "test");
  const analyzedContents = [...contentByPath.values()].join("\n");

  const signals: RepoSignals = {
    hasReadme: files.some((f) => /^readme(\.|$)/i.test(f.path.split("/").pop() ?? "")),
    hasLicense: files.some((f) => /^(license|licence|copying)(\.|$)/i.test(f.path.split("/").pop() ?? "")),
    hasCi: files.some((f) => f.role === "ci"),
    hasTests: testFiles.length > 0,
    hasTestFramework: TEST_FRAMEWORKS.some((f) => depNames.has(f)) || Boolean(scripts["test"]),
    hasDockerfile: has((p) => /(^|\/)dockerfile/.test(p)),
    hasDeployConfig: has((p) =>
      /(^|\/)(vercel\.json|render\.yaml|netlify\.toml|firebase\.json|fly\.toml|app\.yaml|cloudbuild\.yaml|serverless\.yml)$/.test(p),
    ),
    hasEnvExample: has((p) => /(^|\/)\.env\.(example|sample|template)$/.test(p)),
    hasMigrations: files.some((f) => f.role === "migration"),
    hasLockfile: files.some((f) => f.role === "lockfile"),
    hasBuildScript: Boolean(scripts["build"]),
    hasStartScript: Boolean(scripts["start"] ?? scripts["dev"] ?? scripts["serve"]),
    hasTypecheckScript: Boolean(scripts["typecheck"] ?? scripts["tsc"] ?? scripts["check-types"]),
    hasTestScript: Boolean(scripts["test"]),
    hasObservability: OBSERVABILITY_PACKAGES.some((p) => depNames.has(p)),
    hasAuth: AUTH_PACKAGES.some((p) => depNames.has(p)) || /requireAuth|authenticate|withAuth|isAuthenticated/.test(analyzedContents),
    hasRateLimit: RATE_LIMIT_PACKAGES.some((p) => depNames.has(p)) || /rateLimit\s*\(/.test(analyzedContents),
    hasHealthEndpoint: [...apiRoutes].some((r) => /\/(health|healthz|readyz|livez|status)\b/.test(r)),
    hasErrorHandling: /catch\s*\(|\.catch\s*\(|except\s+\w*Error/.test(analyzedContents),
    hasContainerOrchestration: has((p) => /(^|\/)(docker-compose|k8s\/|helm\/|terraform\/)/.test(p)),
    envVarRefs: [...envVarRefs].sort(),
    apiRoutes: [...apiRoutes].sort(),
    frontendRoutes: [...frontendRoutes].sort(),
    testFileCount: testFiles.length,
    sourceFileCount: sourceFiles.length,
    docFileCount: files.filter((f) => f.role === "docs").length,
    migrationFileCount: files.filter((f) => f.role === "migration").length,
  };

  const analyzableBlobCount = blobs.filter((b) => classifyFileRole(b.path) !== "asset").length;

  return {
    repo: input.repo,
    defaultBranch: input.defaultBranch,
    indexedAt: now.toISOString(),
    files,
    modules,
    dependencies: dedupeDependencies(dependencies),
    signals,
    stubs,
    functionCounts: { total: totalFunctions, stubbed: stubbedFunctions },
    truncated: analyzableBlobCount > maxFiles,
    analyzedFileCount: files.filter((f) => f.analyzed).length,
    totalFileCount: blobs.length,
  };
}

function dedupeDependencies(deps: DependencyRef[]): DependencyRef[] {
  const seen = new Map<string, DependencyRef>();
  for (const dep of deps) {
    const key = `${dep.kind}:${dep.name}`;
    if (!seen.has(key)) seen.set(key, dep);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}

/** Resolve a relative import specifier to the module id it points at. */
export function resolveInternalImport(fromModuleId: string, specifier: string): string | null {
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    const withoutAlias = specifier.slice(2);
    const dir = withoutAlias.split("/").slice(0, -1).join("/");
    return dir === "" ? "src" : `src/${dir}`;
  }
  if (!specifier.startsWith(".")) return null;

  const base = fromModuleId === "." ? [] : fromModuleId.split("/");
  const parts = specifier.split("/");
  const stack = [...base];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "." || part === "") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    // The final segment is the module file itself unless the path ends with "/"
    if (i === parts.length - 1) break;
    stack.push(part);
  }

  return stack.length === 0 ? "." : stack.join("/");
}
