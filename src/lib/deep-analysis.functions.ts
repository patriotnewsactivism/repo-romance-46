// Deep Structural Analysis — goes beyond surface-level health checks.
// Reads actual code to determine: built vs. stubbed, test coverage,
// dependency health, deploy readiness, and honest completion percentage.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ─────────────────────────────────────────────────────

export interface StubDetection {
  file: string;
  line: number;
  kind: "stub" | "todo" | "fixme" | "hack" | "unimplemented" | "placeholder";
  snippet: string;
}

export interface DependencyHealth {
  name: string;
  current: string;
  latest: string | null;
  status: "up-to-date" | "minor-behind" | "major-behind" | "unknown";
  isDevDep: boolean;
}

export interface TestCoverage {
  hasTestFramework: boolean;
  framework: string | null;
  testFileCount: number;
  sourceFileCount: number;
  testToSourceRatio: number;
  coveredPaths: string[];
  uncoveredPaths: string[];
}

export interface DeployReadiness {
  hasBuildScript: boolean;
  hasStartScript: boolean;
  hasBuildConfig: boolean;
  hasDeployConfig: boolean;
  deployTarget: string | null;
  missingEnvVars: string[];
  hasEnvExample: boolean;
  hasDockerfile: boolean;
  issues: string[];
}

export interface CompletionBreakdown {
  percentage: number;
  verdict: "abandoned-scaffolding" | "early-stage" | "half-built" | "mostly-done" | "shippable";
  builtCount: number;
  stubbedCount: number;
  totalFunctions: number;
  evidence: string[];
}

export interface DeepAnalysisResult {
  repo: string;
  analyzedAt: string;
  stubs: StubDetection[];
  dependencyHealth: DependencyHealth[];
  testCoverage: TestCoverage;
  deployReadiness: DeployReadiness;
  completion: CompletionBreakdown;
  fileBreakdown: {
    total: number;
    source: number;
    test: number;
    config: number;
    docs: number;
    other: number;
  };
  summary: string;
}

// ─── GitHub helpers ────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
  };
}

async function ghFetch(token: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, { headers: ghHeaders(token) });
}

async function ghRaw(token: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
    {
      headers: {
        ...ghHeaders(token),
        Accept: "application/vnd.github.raw",
      },
    },
  );
  if (!res.ok) return null;
  return res.text();
}

// ─── Stub / TODO / Incomplete Detection ────────────────────────

const STUB_PATTERNS: {
  pattern: RegExp;
  kind: StubDetection["kind"];
}[] = [
  { pattern: /\bTODO\b[:\s]/i, kind: "todo" },
  { pattern: /\bFIXME\b[:\s]/i, kind: "fixme" },
  { pattern: /\bHACK\b[:\s]/i, kind: "hack" },
  { pattern: /\btodo!\(\)/i, kind: "todo" }, // Rust
  { pattern: /\bunimplemented!\(\)/i, kind: "unimplemented" }, // Rust
  { pattern: /\bNotImplementedError\b/i, kind: "unimplemented" }, // Python
  { pattern: /throw new Error\(['"]not implemented/i, kind: "unimplemented" },
  { pattern: /\/\/\s*stub\b/i, kind: "stub" },
  { pattern: /\/\*\s*stub\b/i, kind: "stub" },
  { pattern: /#\s*stub\b/i, kind: "stub" },
  { pattern: /\bplaceholder\b/i, kind: "placeholder" },
  { pattern: /\bconsole\.log\(['"]TODO/i, kind: "todo" },
  { pattern: /pass\s*#\s*(todo|stub|placeholder)/i, kind: "stub" }, // Python
];

// Patterns indicating a function is just a stub body
const STUB_BODY_PATTERNS = [
  /^\s*\{\s*\}\s*$/, // empty braces
  /^\s*\{\s*\/\/.*\}\s*$/, // braces with only a comment
  /^\s*\{\s*return\s*(null|undefined|void 0|''|""|\{\}|\[\])\s*;?\s*\}\s*$/, // returns nothing useful
  /^\s*\{\s*throw\s+new\s+Error\s*\(/, // throws "not implemented"
  /^\s*pass\s*$/, // Python pass
];

function detectStubs(content: string, filePath: string): StubDetection[] {
  const stubs: StubDetection[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, kind } of STUB_PATTERNS) {
      if (pattern.test(line)) {
        stubs.push({
          file: filePath,
          line: i + 1,
          kind,
          snippet: line.trim().slice(0, 120),
        });
        break; // one match per line
      }
    }
  }

  return stubs;
}

// Count exported/declared functions and check if they're stubbed
function countFunctions(content: string): { total: number; stubbed: number } {
  // Match function declarations, arrow functions, class methods
  const fnPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+\w+/g,
    /(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(/g,
    /(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\w+\s*=>/g,
    /^\s+(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm, // class methods
    /def\s+\w+\s*\(/g, // Python
    /fn\s+\w+\s*\(/g, // Rust
    /func\s+\w+\s*\(/g, // Go
  ];

  let total = 0;
  for (const pattern of fnPatterns) {
    const matches = content.match(pattern);
    if (matches) total += matches.length;
  }

  // Count stubbed function bodies
  let stubbed = 0;
  for (const pattern of STUB_BODY_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) stubbed += matches.length;
  }

  return { total, stubbed: Math.min(stubbed, total) };
}

// ─── Dependency Health Check ───────────────────────────────────

interface NpmRegistryVersion {
  version: string;
}

async function checkNpmPackage(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NpmRegistryVersion;
    return data.version;
  } catch {
    return null;
  }
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const clean = v.replace(/^[\^~>=<]*/, "").replace(/\s.*$/, "");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

function compareVersions(
  current: string,
  latest: string,
): "up-to-date" | "minor-behind" | "major-behind" {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return "up-to-date";
  if (l.major > c.major) return "major-behind";
  if (l.minor > c.minor || l.patch > c.patch) return "minor-behind";
  return "up-to-date";
}

async function checkDependencyHealth(packageJsonText: string): Promise<DependencyHealth[]> {
  try {
    const pkg = JSON.parse(packageJsonText);
    const deps = Object.entries(pkg.dependencies || {}) as [string, string][];
    const devDeps = Object.entries(pkg.devDependencies || {}) as [string, string][];

    // Check a sample of dependencies (max 20 to avoid rate limits)
    const allDeps = [
      ...deps.slice(0, 12).map(([name, version]) => ({ name, version, isDevDep: false })),
      ...devDeps.slice(0, 8).map(([name, version]) => ({ name, version, isDevDep: true })),
    ];

    const results: DependencyHealth[] = [];

    // Check in parallel with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < allDeps.length; i += batchSize) {
      const batch = allDeps.slice(i, i + batchSize);
      const checks = await Promise.all(
        batch.map(async (dep) => {
          const latest = await checkNpmPackage(dep.name);
          const status = latest ? compareVersions(dep.version, latest) : ("unknown" as const);
          return {
            name: dep.name,
            current: dep.version,
            latest,
            status,
            isDevDep: dep.isDevDep,
          };
        }),
      );
      results.push(...checks);
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Test Coverage Analysis ────────────────────────────────────

const TEST_FRAMEWORKS: Record<string, RegExp> = {
  jest: /jest|@jest/,
  vitest: /vitest/,
  mocha: /mocha/,
  ava: /\bava\b/,
  tap: /\btap\b/,
  pytest: /pytest/,
  unittest: /unittest/,
  "go test": /testing/,
  "cargo test": /\[cfg\(test\)\]/,
};

function analyzeTestCoverage(
  tree: { path: string; type: string }[],
  packageJson: string | null,
): TestCoverage {
  const files = tree.filter((t) => t.type === "blob");

  const sourceExts = /\.(ts|tsx|js|jsx|py|go|rs|rb|java|swift|kt|vue|svelte)$/;
  const testPatterns = /test|spec|__tests__|\.test\.|\.spec\.|_test\.|tests\//i;

  const sourceFiles = files.filter(
    (f) =>
      sourceExts.test(f.path) &&
      !testPatterns.test(f.path) &&
      !f.path.includes("node_modules") &&
      !f.path.includes("dist") &&
      !f.path.includes(".next"),
  );

  const testFiles = files.filter(
    (f) =>
      sourceExts.test(f.path) &&
      testPatterns.test(f.path) &&
      !f.path.includes("node_modules"),
  );

  // Detect test framework from package.json
  let framework: string | null = null;
  let hasTestFramework = false;
  if (packageJson) {
    for (const [name, pattern] of Object.entries(TEST_FRAMEWORKS)) {
      if (pattern.test(packageJson)) {
        framework = name;
        hasTestFramework = true;
        break;
      }
    }
  }

  // Determine which source dirs have test coverage
  const sourceDirs = new Set(sourceFiles.map((f) => f.path.split("/").slice(0, -1).join("/")));
  const testDirs = new Set(testFiles.map((f) => f.path.split("/").slice(0, -1).join("/")));

  const coveredPaths: string[] = [];
  const uncoveredPaths: string[] = [];

  for (const dir of sourceDirs) {
    // Check if there's a corresponding test directory or test files
    const hasTests =
      testDirs.has(dir) ||
      testDirs.has(`${dir}/__tests__`) ||
      testDirs.has(`${dir}/tests`) ||
      testDirs.has(`tests/${dir}`) ||
      testFiles.some((t) => t.path.includes(dir.split("/").pop()!));

    if (hasTests) {
      coveredPaths.push(dir);
    } else if (dir) {
      uncoveredPaths.push(dir);
    }
  }

  return {
    hasTestFramework,
    framework,
    testFileCount: testFiles.length,
    sourceFileCount: sourceFiles.length,
    testToSourceRatio: sourceFiles.length > 0 ? Math.round((testFiles.length / sourceFiles.length) * 100) / 100 : 0,
    coveredPaths: coveredPaths.slice(0, 20),
    uncoveredPaths: uncoveredPaths.slice(0, 20),
  };
}

// ─── Deploy Readiness Check ────────────────────────────────────

function checkDeployReadiness(
  tree: { path: string; type: string }[],
  packageJson: string | null,
  envExample: string | null,
  envFile: string | null,
): DeployReadiness {
  const paths = tree.filter((t) => t.type === "blob").map((t) => t.path);

  let hasBuildScript = false;
  let hasStartScript = false;
  let deployTarget: string | null = null;

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      hasBuildScript = !!pkg.scripts?.build;
      hasStartScript = !!pkg.scripts?.start || !!pkg.scripts?.dev;
    } catch { /* ignore */ }
  }

  // Check for deploy configs
  const hasVercelJson = paths.some((p) => p === "vercel.json");
  const hasNetlifyToml = paths.some((p) => p === "netlify.toml");
  const hasDockerfile = paths.some((p) => /^Dockerfile$/i.test(p));
  const hasRailwayJson = paths.some((p) => p === "railway.json" || p === "railway.toml");
  const hasWranglerToml = paths.some((p) => /^wrangler\.(toml|jsonc?)$/i.test(p));
  const hasFlyToml = paths.some((p) => p === "fly.toml");
  const hasRenderYaml = paths.some((p) => p === "render.yaml");

  const hasDeployConfig =
    hasVercelJson || hasNetlifyToml || hasDockerfile || hasRailwayJson || hasWranglerToml || hasFlyToml || hasRenderYaml;

  if (hasVercelJson) deployTarget = "Vercel";
  else if (hasNetlifyToml) deployTarget = "Netlify";
  else if (hasWranglerToml) deployTarget = "Cloudflare Workers";
  else if (hasDockerfile) deployTarget = "Docker";
  else if (hasRailwayJson) deployTarget = "Railway";
  else if (hasFlyToml) deployTarget = "Fly.io";
  else if (hasRenderYaml) deployTarget = "Render";

  // Check for build configs
  const hasBuildConfig = paths.some(
    (p) =>
      /^(vite|next|nuxt|webpack|rollup|esbuild|tsup)\.config\./i.test(p) ||
      p === "tsconfig.json" ||
      p === "Makefile",
  );

  // Check for .env.example
  const hasEnvExample = paths.some((p) => /^\.env\.example$/i.test(p) || /^\.env\.sample$/i.test(p));

  // Detect required env vars from .env.example
  const missingEnvVars: string[] = [];
  if (envExample) {
    const envVars = envExample
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l.trim()))
      .map((l) => l.split("=")[0].trim());
    // If there's no actual .env file, all are "missing"
    if (!envFile) {
      missingEnvVars.push(...envVars.slice(0, 20));
    }
  }

  // Identify issues
  const issues: string[] = [];
  if (!hasBuildScript && packageJson) issues.push("No `build` script in package.json");
  if (!hasStartScript && packageJson) issues.push("No `start` or `dev` script in package.json");
  if (!hasDeployConfig) issues.push("No deployment configuration found (Vercel, Netlify, Docker, etc.)");
  if (!hasEnvExample && envFile) issues.push("Has .env but no .env.example — others can't set up the project");
  if (missingEnvVars.length > 0) issues.push(`${missingEnvVars.length} env vars need to be configured`);
  if (!hasBuildConfig && packageJson) issues.push("No build tool config (vite, next, webpack, etc.)");

  return {
    hasBuildScript,
    hasStartScript,
    hasBuildConfig,
    hasDeployConfig,
    deployTarget,
    missingEnvVars: missingEnvVars.slice(0, 20),
    hasEnvExample,
    hasDockerfile,
    issues,
  };
}

// ─── Completion Percentage Calculation ─────────────────────────

function calculateCompletion(
  stubs: StubDetection[],
  testCoverage: TestCoverage,
  deployReadiness: DeployReadiness,
  functionCounts: { total: number; stubbed: number },
  tree: { path: string; type: string }[],
  hasReadme: boolean,
  hasLicense: boolean,
): CompletionBreakdown {
  const evidence: string[] = [];
  let score = 0;
  const maxScore = 100;

  const files = tree.filter((t) => t.type === "blob");
  const sourceFiles = files.filter(
    (f) =>
      /\.(ts|tsx|js|jsx|py|go|rs|rb|java)$/.test(f.path) &&
      !f.path.includes("node_modules") &&
      !f.path.includes("dist") &&
      !/test|spec|__tests__/i.test(f.path),
  );

  // 1. Source code completeness (40 points max)
  const stubRatio =
    functionCounts.total > 0 ? functionCounts.stubbed / functionCounts.total : 0;
  const codeScore = Math.round((1 - stubRatio) * 40);
  score += codeScore;
  if (stubRatio > 0.5) {
    evidence.push(
      `${Math.round(stubRatio * 100)}% of detected functions are stubs or empty — most code is scaffolding`,
    );
  } else if (stubRatio > 0.2) {
    evidence.push(
      `${Math.round(stubRatio * 100)}% of functions are stubs — partially implemented`,
    );
  } else if (functionCounts.total > 0) {
    evidence.push(
      `${functionCounts.total - functionCounts.stubbed}/${functionCounts.total} functions appear implemented`,
    );
  }

  // Penalize for TODO/FIXME density
  const todosPerFile = sourceFiles.length > 0 ? stubs.length / sourceFiles.length : 0;
  if (todosPerFile > 1) {
    score -= 5;
    evidence.push(`High density of TODOs/FIXMEs: ${stubs.length} across ${sourceFiles.length} files`);
  }

  // 2. Test coverage (20 points max)
  if (testCoverage.hasTestFramework && testCoverage.testFileCount > 0) {
    const testScore = Math.min(20, Math.round(testCoverage.testToSourceRatio * 40));
    score += testScore;
    evidence.push(
      `${testCoverage.testFileCount} test files covering ${testCoverage.coveredPaths.length} directories`,
    );
  } else if (testCoverage.hasTestFramework) {
    score += 5;
    evidence.push("Test framework configured but no test files found");
  } else {
    evidence.push("No test framework or test files — cannot self-check");
  }

  // 3. Deploy readiness (20 points max)
  let deployScore = 0;
  if (deployReadiness.hasBuildScript) deployScore += 5;
  if (deployReadiness.hasStartScript) deployScore += 3;
  if (deployReadiness.hasBuildConfig) deployScore += 4;
  if (deployReadiness.hasDeployConfig) deployScore += 5;
  if (deployReadiness.hasEnvExample) deployScore += 3;
  score += Math.min(20, deployScore);
  if (deployReadiness.issues.length > 0) {
    evidence.push(`Deploy issues: ${deployReadiness.issues.slice(0, 3).join("; ")}`);
  } else {
    evidence.push("Deploy configuration looks complete");
  }

  // 4. Documentation (10 points max)
  let docScore = 0;
  if (hasReadme) {
    docScore += 6;
    evidence.push("Has README");
  } else {
    evidence.push("Missing README");
  }
  if (hasLicense) {
    docScore += 4;
  } else {
    evidence.push("Missing LICENSE");
  }
  score += docScore;

  // 5. Project structure (10 points max)
  const hasSrcDir = files.some((f) => f.path.startsWith("src/"));
  const hasEntryPoint = files.some((f) =>
    /^(src\/)?(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.path),
  );
  let structureScore = 0;
  if (hasSrcDir) structureScore += 5;
  if (hasEntryPoint) structureScore += 5;
  score += structureScore;
  if (!hasEntryPoint) evidence.push("No clear entry point found");

  // Clamp and determine verdict
  const percentage = Math.max(0, Math.min(maxScore, score));

  let verdict: CompletionBreakdown["verdict"];
  if (percentage < 15) verdict = "abandoned-scaffolding";
  else if (percentage < 35) verdict = "early-stage";
  else if (percentage < 60) verdict = "half-built";
  else if (percentage < 85) verdict = "mostly-done";
  else verdict = "shippable";

  return {
    percentage,
    verdict,
    builtCount: functionCounts.total - functionCounts.stubbed,
    stubbedCount: functionCounts.stubbed,
    totalFunctions: functionCounts.total,
    evidence,
  };
}

// ─── File Breakdown ────────────────────────────────────────────

function categorizeFiles(tree: { path: string; type: string }[]) {
  const files = tree.filter((t) => t.type === "blob");
  let source = 0, test = 0, config = 0, docs = 0, other = 0;

  for (const f of files) {
    if (f.path.includes("node_modules") || f.path.includes("dist")) continue;
    if (/test|spec|__tests__/i.test(f.path)) test++;
    else if (/\.(ts|tsx|js|jsx|py|go|rs|rb|java|swift|kt|vue|svelte|css|scss)$/.test(f.path))
      source++;
    else if (
      /\.(json|toml|yaml|yml|xml|ini|env|config|rc)$/.test(f.path) ||
      /^(Makefile|Dockerfile|Procfile|Gemfile)$/i.test(f.path.split("/").pop()!)
    )
      config++;
    else if (/\.(md|txt|rst|adoc|doc)$/i.test(f.path) || /^(LICENSE|CHANGELOG|CONTRIBUTING)/i.test(f.path.split("/").pop()!))
      docs++;
    else other++;
  }

  return { total: files.length, source, test, config, docs, other };
}

// ─── Parallel file fetch ───────────────────────────────────────

async function fetchFilesParallel(
  token: string,
  repo: string,
  paths: string[],
  concurrency: number = 5,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let next = 0;

  async function worker() {
    while (next < paths.length) {
      const i = next++;
      const content = await ghRaw(token, repo, paths[i]);
      if (content !== null) results.set(paths[i], content);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return results;
}

// ─── Main Server Function ──────────────────────────────────────

export const deepAnalyzeRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    // Get GitHub token
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = (conn as { access_token: string }).access_token;

    // 1. Fetch repo metadata
    const repoRes = await ghFetch(token, `/repos/${data.repo}`);
    if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
    const repoMeta = (await repoRes.json()) as {
      default_branch: string;
      description: string | null;
      license: { spdx_id: string } | null;
    };

    // 2. Fetch file tree
    const treeRes = await ghFetch(
      token,
      `/repos/${data.repo}/git/trees/${repoMeta.default_branch}?recursive=1`,
    );
    if (!treeRes.ok) throw new Error("Failed to fetch file tree");
    const treeData = (await treeRes.json()) as {
      tree: { path: string; type: string; size?: number }[];
      truncated: boolean;
    };

    const tree = treeData.tree;
    const blobs = tree.filter(
      (t) => t.type === "blob" && !t.path.includes("node_modules") && !t.path.includes(".git/"),
    );

    // 3. Identify key files to fetch for deep analysis
    const sourceExts = /\.(ts|tsx|js|jsx|py|go|rs|rb|java)$/;
    const sourceFiles = blobs
      .filter(
        (f) =>
          sourceExts.test(f.path) &&
          !/test|spec|__tests__|\.test\.|\.spec\./i.test(f.path) &&
          !f.path.includes("dist") &&
          !f.path.includes(".next") &&
          !f.path.includes("node_modules"),
      )
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

    // Fetch the top source files + key config files
    const filesToFetch = [
      "package.json",
      "README.md",
      "readme.md",
      ".env.example",
      ".env.sample",
      ".env",
      "tsconfig.json",
      ...sourceFiles.slice(0, 15).map((f) => f.path),
    ].filter((p) => blobs.some((b) => b.path === p));

    const fileContents = await fetchFilesParallel(token, data.repo, filesToFetch, 5);

    // 4. Detect stubs and count functions across all fetched source files
    const allStubs: StubDetection[] = [];
    let totalFunctions = 0;
    let totalStubbed = 0;

    for (const [path, content] of fileContents) {
      if (!sourceExts.test(path)) continue;
      const stubs = detectStubs(content, path);
      allStubs.push(...stubs);

      const counts = countFunctions(content);
      totalFunctions += counts.total;
      totalStubbed += counts.stubbed;
    }

    // 5. Dependency health check
    const packageJson = fileContents.get("package.json") ?? null;
    const depHealth = packageJson ? await checkDependencyHealth(packageJson) : [];

    // 6. Test coverage analysis
    const testCoverage = analyzeTestCoverage(tree, packageJson);

    // 7. Deploy readiness
    const envExample = fileContents.get(".env.example") ?? fileContents.get(".env.sample") ?? null;
    const envFile = fileContents.get(".env") ?? null;
    const deployReadiness = checkDeployReadiness(tree, packageJson, envExample, envFile);

    // 8. Calculate completion
    const hasReadme = blobs.some((f) => /^readme/i.test(f.path));
    const hasLicense = !!repoMeta.license || blobs.some((f) => /^license/i.test(f.path));
    const completion = calculateCompletion(
      allStubs,
      testCoverage,
      deployReadiness,
      { total: totalFunctions, stubbed: totalStubbed },
      tree,
      hasReadme,
      hasLicense,
    );

    // 9. File breakdown
    const fileBreakdown = categorizeFiles(tree);

    // 10. Build summary
    const outdatedDeps = depHealth.filter((d) => d.status === "major-behind");
    const summaryParts = [
      `**Completion: ${completion.percentage}%** — ${completion.verdict.replace(/-/g, " ")}`,
    ];
    if (allStubs.length > 0) {
      summaryParts.push(
        `${allStubs.length} TODOs/stubs/FIXMEs found across ${new Set(allStubs.map((s) => s.file)).size} files`,
      );
    }
    if (outdatedDeps.length > 0) {
      summaryParts.push(
        `${outdatedDeps.length} dependencies are a major version behind`,
      );
    }
    if (testCoverage.testFileCount === 0) {
      summaryParts.push("No tests — can't verify anything works");
    }
    if (deployReadiness.issues.length > 0) {
      summaryParts.push(`${deployReadiness.issues.length} deploy issue(s)`);
    }

    const result: DeepAnalysisResult = {
      repo: data.repo,
      analyzedAt: new Date().toISOString(),
      stubs: allStubs.slice(0, 50), // cap for response size
      dependencyHealth: depHealth,
      testCoverage,
      deployReadiness,
      completion,
      fileBreakdown,
      summary: summaryParts.join(". ") + ".",
    };

    // Save to repo_learnings for persistent memory
    const { data: existingLearning } = await (
      context.supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              eq: (
                c: string,
                v: string,
              ) => { maybeSingle: () => Promise<{ data: unknown }> };
            };
          };
        };
      }
    )
      .from("repo_learnings")
      .select("id")
      .eq("user_id", context.userId)
      .eq("repo", data.repo)
      .maybeSingle();

    const learningPayload = {
      user_id: context.userId,
      repo: data.repo,
      last_analysis: result as unknown as Record<string, unknown>,
      analyzed_at: new Date().toISOString(),
    };

    if (existingLearning) {
      await (context.supabase as unknown as {
        from: (t: string) => {
          update: (v: Record<string, unknown>) => {
            eq: (c: string, v: string) => Promise<unknown>;
          };
        };
      })
        .from("repo_learnings")
        .update(learningPayload)
        .eq("id", (existingLearning as { id: string }).id);
    } else {
      await (context.supabase as unknown as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<unknown>;
        };
      })
        .from("repo_learnings")
        .insert(learningPayload);
    }

    return result;
  });
