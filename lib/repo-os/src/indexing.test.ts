import { describe, expect, it } from "vitest";
import {
  buildRepoIndex,
  classifyFileRole,
  isVendored,
  parsePackageManifest,
  resolveInternalImport,
  selectFilesToAnalyze,
} from "./indexing";
import { abandonedScaffoldFixture, healthyApiFixture } from "./repo.fixtures";

describe("classifyFileRole", () => {
  it.each([
    [".github/workflows/ci.yml", "ci"],
    ["Dockerfile", "infra"],
    ["package.json", "manifest"],
    ["pnpm-lock.yaml", "lockfile"],
    ["src/thing.test.ts", "test"],
    ["src/__tests__/thing.ts", "test"],
    ["migrations/0001_init.sql", "migration"],
    ["README.md", "docs"],
    ["src/index.ts", "source"],
    ["public/logo.png", "asset"],
    ["tsconfig.json", "config"],
  ])("classifies %s as %s", (path, role) => {
    expect(classifyFileRole(path)).toBe(role);
  });
});

describe("isVendored", () => {
  it("excludes dependency and build output directories", () => {
    expect(isVendored("node_modules/left-pad/index.js")).toBe(true);
    expect(isVendored("packages/app/node_modules/x/i.js")).toBe(true);
    expect(isVendored("dist/bundle.js")).toBe(true);
    expect(isVendored("src/dist-helpers.ts")).toBe(false);
  });
});

describe("selectFilesToAnalyze", () => {
  const tree = [
    { path: "src/deep/nested/thing.ts", type: "blob" as const, size: 100 },
    { path: "README.md", type: "blob" as const, size: 100 },
    { path: "package.json", type: "blob" as const, size: 100 },
    { path: "node_modules/x/index.js", type: "blob" as const, size: 100 },
    { path: "huge.ts", type: "blob" as const, size: 999_999 },
    { path: "src", type: "tree" as const },
  ];

  it("puts manifests and README first and skips vendored or oversized files", () => {
    const selected = selectFilesToAnalyze(tree);
    expect(selected[0]).toBe("package.json");
    expect(selected[1]).toBe("README.md");
    expect(selected).not.toContain("node_modules/x/index.js");
    expect(selected).not.toContain("huge.ts");
  });

  it("respects the ingestion budget", () => {
    expect(selectFilesToAnalyze(tree, { maxAnalyzedFiles: 2 })).toHaveLength(2);
  });

  it("is deterministic for the same tree", () => {
    expect(selectFilesToAnalyze(tree)).toEqual(selectFilesToAnalyze([...tree].reverse()));
  });
});

describe("resolveInternalImport", () => {
  it.each([
    ["src/routes", "./thing", "src/routes"],
    ["src/routes", "../lib/thing", "src/lib"],
    ["src/routes", "../../top", "."],
    ["src/routes", "./nested/deep/thing", "src/routes/nested/deep"],
    [".", "./thing", "."],
  ])("resolves %s + %s to %s", (from, spec, expected) => {
    expect(resolveInternalImport(from, spec)).toBe(expected);
  });

  it("maps the @/ alias to the src root", () => {
    expect(resolveInternalImport("src/pages", "@/lib/utils")).toBe("src/lib");
  });

  it("returns null for bare package specifiers", () => {
    expect(resolveInternalImport("src", "express")).toBeNull();
  });
});

describe("parsePackageManifest", () => {
  it("collects dependencies by kind and reads scripts", () => {
    const parsed = parsePackageManifest(
      JSON.stringify({ dependencies: { a: "1" }, devDependencies: { b: "2" }, peerDependencies: { c: "3" }, scripts: { build: "tsc" } }),
    );
    expect(parsed.dependencies).toEqual([
      { name: "a", range: "1", kind: "prod" },
      { name: "b", range: "2", kind: "dev" },
      { name: "c", range: "3", kind: "peer" },
    ]);
    expect(parsed.scripts["build"]).toBe("tsc");
  });

  it("survives malformed JSON", () => {
    expect(parsePackageManifest("{ not json")).toEqual({ dependencies: [], scripts: {} });
  });
});

describe("buildRepoIndex", () => {
  const index = healthyApiFixture();

  it("excludes vendored files from the tree entirely", () => {
    expect(index.files.some((f) => f.path.startsWith("node_modules/"))).toBe(false);
  });

  it("builds a module graph with imports, exports and external dependencies", () => {
    const src = index.modules.find((m) => m.id === "src");
    expect(src).toBeDefined();
    expect(src?.externalDeps).toContain("express");
    expect(src?.imports).toContain("src/middlewares");
    expect(src?.exports).toContain("listWidgets");
  });

  it("derives capability signals from manifests and source", () => {
    expect(index.signals.hasCi).toBe(true);
    expect(index.signals.hasDockerfile).toBe(true);
    expect(index.signals.hasMigrations).toBe(true);
    expect(index.signals.hasRateLimit).toBe(true);
    expect(index.signals.hasObservability).toBe(true);
    expect(index.signals.hasHealthEndpoint).toBe(true);
    expect(index.signals.hasAuth).toBe(true);
    expect(index.signals.envVarRefs).toContain("DATABASE_URL");
    expect(index.signals.apiRoutes).toContain("GET /health");
    expect(index.signals.testFileCount).toBe(2);
  });

  it("counts real functions as implemented", () => {
    expect(index.functionCounts.total).toBeGreaterThan(0);
    expect(index.functionCounts.stubbed).toBe(0);
  });

  it("flags a scaffold as mostly stubbed", () => {
    const scaffold = abandonedScaffoldFixture();
    expect(scaffold.functionCounts.stubbed / scaffold.functionCounts.total).toBeGreaterThan(0.5);
    expect(scaffold.stubs.length).toBeGreaterThan(5);
  });

  it("reports truncation when the tree exceeds the ingestion budget", () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ path: `src/f${i}.ts`, type: "blob" as const, size: 10 }));
    expect(healthyApiFixture().truncated).toBe(false);
    const overBudget = buildRepoIndex({ repo: "a/b", defaultBranch: "main", tree: big, files: [], options: { maxAnalyzedFiles: 10 } });
    expect(overBudget.truncated).toBe(true);
  });

  it("is reproducible", () => {
    expect(healthyApiFixture()).toEqual(healthyApiFixture());
  });
});
