// Shared pure scoring utilities for ratings, recommendation ranking, and valuations.
// Kept free of server/framework imports so unit tests can run without Vite.

export type HealthFactor = {
  name: string;
  status: boolean;
  weight: number;
  detail?: string;
};

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export type CompletionVerdict =
  | "abandoned-scaffolding"
  | "early-stage"
  | "half-built"
  | "mostly-done"
  | "shippable";

export type StubKind = "stub" | "todo" | "fixme" | "hack" | "unimplemented" | "placeholder";

export interface StubHit {
  file: string;
  line: number;
  kind: StubKind;
  snippet: string;
}

export interface RecommendationScores {
  effort: number;
  market_potential: number;
  estimated_hours?: number | null;
  kind?: string;
  /** 0–100 structural completion when known */
  completion_pct?: number | null;
  /** prior failed finish attempts on these repos */
  failure_penalty?: number;
}

// ── Clamp helpers ──────────────────────────────────────────────────────────

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clampScore1to5(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.round(clamp(n, 1, 5));
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(clamp(n, 0, 100));
}

// ── Health score (surface ratings) ─────────────────────────────────────────

export function gradeFromScore(score: number): HealthGrade {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

export interface HealthInputs {
  hasReadme: boolean;
  hasDescription: boolean;
  hasCI: boolean;
  hasTests: boolean;
  hasLicense: boolean;
  hasTopics: boolean;
  daysSincePush: number | null;
  stars: number;
  hasHomepage: boolean;
  openIssues?: number;
  isArchived?: boolean;
}

/**
 * Deterministic 0–100 health score. Partial credit for activity bands and
 * description-without-README so grades are less binary than the old checklist.
 */
export function computeHealthScore(input: HealthInputs): {
  healthScore: number;
  grade: HealthGrade;
  factors: HealthFactor[];
} {
  const factors: HealthFactor[] = [];
  let score = 0;

  // README (12) + description (5) — separate signals
  factors.push({
    name: "Has README",
    status: input.hasReadme,
    weight: 12,
    detail: input.hasReadme ? "README present in tree" : "No README file found",
  });
  if (input.hasReadme) score += 12;

  factors.push({
    name: "Has description",
    status: input.hasDescription,
    weight: 5,
    detail: input.hasDescription ? "GitHub description set" : "Missing repo description",
  });
  if (input.hasDescription) score += 5;

  factors.push({ name: "CI configured", status: input.hasCI, weight: 18 });
  if (input.hasCI) score += 18;

  factors.push({ name: "Has tests", status: input.hasTests, weight: 18 });
  if (input.hasTests) score += 18;

  factors.push({ name: "Has license", status: input.hasLicense, weight: 10 });
  if (input.hasLicense) score += 10;

  factors.push({ name: "Has topics", status: input.hasTopics, weight: 7 });
  if (input.hasTopics) score += 7;

  // Activity — tiered, not binary 3-month cutoff
  const days = input.daysSincePush;
  let activityPts = 0;
  let activityLabel = "Inactive / unknown";
  if (days !== null && Number.isFinite(days)) {
    if (days <= 30) {
      activityPts = 15;
      activityLabel = "Active (pushed <30d)";
    } else if (days <= 90) {
      activityPts = 12;
      activityLabel = "Active (pushed <3mo)";
    } else if (days <= 180) {
      activityPts = 6;
      activityLabel = "Quiet (pushed <6mo)";
    } else if (days <= 365) {
      activityPts = 2;
      activityLabel = "Stale (pushed <1y)";
    } else {
      activityPts = 0;
      activityLabel = "Dormant (>1y)";
    }
  }
  factors.push({
    name: activityLabel,
    status: activityPts >= 12,
    weight: 15,
    detail: days === null ? "No push date" : `${days} days since last push`,
  });
  score += activityPts;

  // Stars — soft signal
  const stars = Math.max(0, input.stars || 0);
  let starPts = 0;
  if (stars >= 50) starPts = 5;
  else if (stars >= 10) starPts = 4;
  else if (stars >= 1) starPts = 3;
  factors.push({
    name: stars > 0 ? `Has stars (${stars})` : "Has stars",
    status: starPts > 0,
    weight: 5,
  });
  score += starPts;

  factors.push({ name: "Has homepage/demo", status: input.hasHomepage, weight: 10 });
  if (input.hasHomepage) score += 10;

  // Penalties
  if (input.isArchived) {
    score = Math.max(0, score - 15);
    factors.push({
      name: "Archived",
      status: false,
      weight: 0,
      detail: "−15: repository is archived",
    });
  }

  const openIssues = input.openIssues ?? 0;
  if (openIssues > 50) {
    score = Math.max(0, score - 5);
    factors.push({
      name: "Issue backlog",
      status: false,
      weight: 0,
      detail: `−5: ${openIssues} open issues`,
    });
  }

  const healthScore = clampPct(score);
  return { healthScore, grade: gradeFromScore(healthScore), factors };
}

// ── Stub / function detection ──────────────────────────────────────────────

export const STUB_PATTERNS: { pattern: RegExp; kind: StubKind }[] = [
  { pattern: /\bTODO\b[:\s]/i, kind: "todo" },
  { pattern: /\bFIXME\b[:\s]/i, kind: "fixme" },
  { pattern: /\bHACK\b[:\s]/i, kind: "hack" },
  { pattern: /\btodo!\(\)/i, kind: "todo" },
  { pattern: /\bunimplemented!\(\)/i, kind: "unimplemented" },
  { pattern: /\bNotImplementedError\b/i, kind: "unimplemented" },
  { pattern: /throw new Error\(['"]not implemented/i, kind: "unimplemented" },
  { pattern: /\/\/\s*stub\b/i, kind: "stub" },
  { pattern: /\/\*\s*stub\b/i, kind: "stub" },
  { pattern: /#\s*stub\b/i, kind: "stub" },
  // Avoid bare "placeholder" (UI copy false positives) — require code-ish context
  { pattern: /\b(placeholder\s*(implementation|function|code)|TODO:\s*placeholder)\b/i, kind: "placeholder" },
  { pattern: /\bconsole\.log\(['"]TODO/i, kind: "todo" },
  { pattern: /pass\s*#\s*(todo|stub|placeholder)/i, kind: "stub" },
  { pattern: /\.skip\s*\(|xit\s*\(|xdescribe\s*\(|it\.todo\s*\(/i, kind: "todo" },
];

const STUB_BODY_LINE = [
  /^\s*\{\s*\}\s*$/,
  /^\s*pass\s*$/,
  /^\s*\.\.\.\s*$/, // Python ellipsis body
  /^\s*return\s*(null|undefined|void 0|None|nil|''|""|``|\{\}|\[\])\s*;?\s*$/,
  /^\s*throw\s+new\s+Error\s*\(\s*['"`](not implemented|TODO|FIXME)/i,
  /^\s*raise\s+NotImplementedError/,
];

export function detectStubs(content: string, filePath: string): StubHit[] {
  const stubs: StubHit[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure string/template noise for placeholder-like matches
    for (const { pattern, kind } of STUB_PATTERNS) {
      if (pattern.test(line)) {
        stubs.push({
          file: filePath,
          line: i + 1,
          kind,
          snippet: line.trim().slice(0, 120),
        });
        break;
      }
    }
  }

  return stubs;
}

/**
 * Count functions with brace-aware stub body detection.
 * Avoids double-counting overlapping regexes by taking the max of language families.
 */
export function countFunctions(content: string): { total: number; stubbed: number } {
  const jsLike = countJsLikeFunctions(content);
  const py = countSimpleDefs(content, /\bdef\s+\w+\s*\(/g);
  const rs = countSimpleDefs(content, /\bfn\s+\w+\s*\(/g);
  const go = countSimpleDefs(content, /\bfunc\s+(\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/g);

  // Prefer the family with the most matches (repo is usually one primary language)
  const candidates = [jsLike, py, rs, go];
  candidates.sort((a, b) => b.total - a.total);
  const best = candidates[0] ?? { total: 0, stubbed: 0 };
  return { total: best.total, stubbed: Math.min(best.stubbed, best.total) };
}

function countSimpleDefs(content: string, pattern: RegExp): { total: number; stubbed: number } {
  const matches = content.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
  const total = matches?.length ?? 0;
  // Heuristic stub density from markers
  const stubMarkers =
    (content.match(/\bNotImplementedError\b|\bunimplemented!\(\)|\btodo!\(\)|\bpass\s*#\s*(todo|stub)/gi) || [])
      .length;
  return { total, stubbed: Math.min(stubMarkers, total) };
}

function countJsLikeFunctions(content: string): { total: number; stubbed: number } {
  // Single-pass-ish: find function-like starts, then inspect following body
  const starts: { index: number }[] = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/g,
    /(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/g,
    /(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?function\s*\(/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, "g");
    while ((m = r.exec(content)) !== null) {
      starts.push({ index: m.index });
    }
  }

  // Class methods: indent + name( + ) {  (skip constructors counted once)
  const methodRe = /^[ \t]+(?:async\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(content)) !== null) {
    if (mm[1] === "if" || mm[1] === "for" || mm[1] === "while" || mm[1] === "switch" || mm[1] === "catch") {
      continue;
    }
    starts.push({ index: mm.index });
  }

  // Dedupe starts within 5 chars (overlapping patterns)
  starts.sort((a, b) => a.index - b.index);
  const deduped: number[] = [];
  for (const s of starts) {
    if (deduped.length === 0 || s.index - deduped[deduped.length - 1] > 5) {
      deduped.push(s.index);
    }
  }

  let stubbed = 0;
  for (const idx of deduped) {
    if (isStubBodyAfter(content, idx)) stubbed++;
  }

  return { total: deduped.length, stubbed };
}

function isStubBodyAfter(content: string, startIdx: number): boolean {
  // Find first `{` or `=>` body after the match
  const slice = content.slice(startIdx, startIdx + 800);
  const brace = slice.indexOf("{");
  const arrow = slice.search(/=>/);

  // Arrow with concise body: `=> null` / `=> undefined` / `=> {}`
  if (arrow !== -1 && (brace === -1 || arrow < brace)) {
    const afterArrow = slice.slice(arrow + 2).trimStart();
    if (/^(null|undefined|void 0|''|""|``|\{\}|\[\])\s*;?/.test(afterArrow)) return true;
    if (afterArrow.startsWith("{")) {
      return isEmptyOrStubBlock(afterArrow);
    }
    return false;
  }

  if (brace === -1) return false;
  return isEmptyOrStubBlock(slice.slice(brace));
}

function isEmptyOrStubBlock(fromBrace: string): boolean {
  // Extract block with simple brace matching
  let depth = 0;
  let end = -1;
  for (let i = 0; i < fromBrace.length; i++) {
    const ch = fromBrace[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return false;
  const body = fromBrace.slice(1, end).trim();
  if (body.length === 0) return true;
  // Only comments
  if (/^(\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s)*$/.test(body)) return true;
  // Single stub statement
  for (const re of STUB_BODY_LINE) {
    if (re.test(body) || re.test(body.split("\n")[0] ?? "")) return true;
  }
  if (/^return\s*(null|undefined|void 0|''|""|``|\{\}|\[\])\s*;?$/.test(body)) return true;
  if (/^throw\s+new\s+Error\s*\(\s*['"`](not implemented|TODO|FIXME)/i.test(body)) return true;
  // Very short body with TODO/FIXME inside
  if (body.length < 80 && /\b(TODO|FIXME|not implemented)\b/i.test(body)) return true;
  return false;
}

// ── Completion percentage ──────────────────────────────────────────────────

export interface CompletionInputs {
  stubs: StubHit[];
  testCoverage: {
    hasTestFramework: boolean;
    testFileCount: number;
    testToSourceRatio: number;
    coveredPaths: string[];
  };
  deployReadiness: {
    hasBuildScript: boolean;
    hasStartScript: boolean;
    hasBuildConfig: boolean;
    hasDeployConfig: boolean;
    hasEnvExample: boolean;
    hasDockerfile: boolean;
    issues: string[];
  };
  functionCounts: { total: number; stubbed: number };
  tree: { path: string; type: string }[];
  hasReadme: boolean;
  hasLicense: boolean;
  /** optional dep health: fraction major-behind 0–1 */
  majorBehindRatio?: number;
}

export interface CompletionBreakdown {
  percentage: number;
  verdict: CompletionVerdict;
  builtCount: number;
  stubbedCount: number;
  totalFunctions: number;
  evidence: string[];
}

export function calculateCompletion(input: CompletionInputs): CompletionBreakdown {
  const evidence: string[] = [];
  let score = 0;

  const files = input.tree.filter((t) => t.type === "blob");
  const sourceFiles = files.filter(
    (f) =>
      /\.(ts|tsx|js|jsx|py|go|rs|rb|java)$/.test(f.path) &&
      !f.path.includes("node_modules") &&
      !f.path.includes("dist") &&
      !/test|spec|__tests__/i.test(f.path),
  );

  const { total, stubbed } = input.functionCounts;
  const stubRatio = total > 0 ? stubbed / total : 0;

  // 1. Source completeness (40)
  // If we found zero functions but many source files, treat as opaque — don't award full 40
  let codeScore: number;
  if (total === 0 && sourceFiles.length > 5) {
    // Density of stub markers as weak signal
    const markerRatio = Math.min(1, input.stubs.length / Math.max(sourceFiles.length, 1) / 2);
    codeScore = Math.round((1 - markerRatio) * 28); // cap at 28 without function evidence
    evidence.push(
      `Could not reliably count functions in ${sourceFiles.length} source files — completeness capped`,
    );
  } else if (total === 0) {
    codeScore = sourceFiles.length > 0 ? 15 : 5;
    evidence.push(
      sourceFiles.length > 0
        ? "Few or no detectable functions — early scaffolding"
        : "No source files detected",
    );
  } else {
    codeScore = Math.round((1 - stubRatio) * 40);
    if (stubRatio > 0.5) {
      evidence.push(
        `${Math.round(stubRatio * 100)}% of detected functions are stubs or empty — most code is scaffolding`,
      );
    } else if (stubRatio > 0.2) {
      evidence.push(`${Math.round(stubRatio * 100)}% of functions are stubs — partially implemented`);
    } else {
      evidence.push(`${total - stubbed}/${total} functions appear implemented`);
    }
  }
  score += codeScore;

  const todosPerFile = sourceFiles.length > 0 ? input.stubs.length / sourceFiles.length : 0;
  if (todosPerFile > 1) {
    score -= 5;
    evidence.push(
      `High density of TODOs/FIXMEs: ${input.stubs.length} across ${sourceFiles.length} files`,
    );
  } else if (input.stubs.length >= 10) {
    score -= 2;
    evidence.push(`${input.stubs.length} incomplete markers found`);
  }

  // 2. Tests (20)
  const tc = input.testCoverage;
  if (tc.hasTestFramework && tc.testFileCount > 0) {
    const testScore = Math.min(20, Math.round(tc.testToSourceRatio * 40));
    score += testScore;
    evidence.push(
      `${tc.testFileCount} test files covering ${tc.coveredPaths.length} directories`,
    );
  } else if (tc.hasTestFramework) {
    score += 5;
    evidence.push("Test framework configured but no test files found");
  } else if (tc.testFileCount > 0) {
    score += Math.min(12, Math.round(tc.testToSourceRatio * 30));
    evidence.push(`${tc.testFileCount} test files without a detected framework`);
  } else {
    evidence.push("No test framework or test files — cannot self-check");
  }

  // 3. Deploy (20)
  const dr = input.deployReadiness;
  let deployScore = 0;
  if (dr.hasBuildScript) deployScore += 5;
  if (dr.hasStartScript) deployScore += 3;
  if (dr.hasBuildConfig) deployScore += 4;
  if (dr.hasDeployConfig) deployScore += 5;
  else if (dr.hasDockerfile) deployScore += 3;
  if (dr.hasEnvExample) deployScore += 3;
  score += Math.min(20, deployScore);
  if (dr.issues.length > 0) {
    evidence.push(`Deploy issues: ${dr.issues.slice(0, 3).join("; ")}`);
  } else if (deployScore >= 15) {
    evidence.push("Deploy configuration looks complete");
  }

  // 4. Docs (10)
  let docScore = 0;
  if (input.hasReadme) {
    docScore += 6;
    evidence.push("Has README");
  } else {
    evidence.push("Missing README");
  }
  if (input.hasLicense) {
    docScore += 4;
  } else {
    evidence.push("Missing LICENSE");
  }
  score += docScore;

  // 5. Structure (10)
  const hasSrcDir = files.some(
    (f) => f.path.startsWith("src/") || f.path.startsWith("lib/") || f.path.startsWith("app/"),
  );
  const hasEntryPoint = files.some((f) =>
    /^(src\/|lib\/|app\/)?(index|main|app|server|cli)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.path),
  );
  let structureScore = 0;
  if (hasSrcDir) structureScore += 5;
  if (hasEntryPoint) structureScore += 5;
  score += structureScore;
  if (!hasEntryPoint) evidence.push("No clear entry point found");

  // Soft penalty for very outdated deps
  if (input.majorBehindRatio !== undefined && input.majorBehindRatio > 0.4) {
    score -= 3;
    evidence.push("Many dependencies are a major version behind");
  }

  const percentage = clampPct(score);
  let verdict: CompletionVerdict;
  if (percentage < 15) verdict = "abandoned-scaffolding";
  else if (percentage < 35) verdict = "early-stage";
  else if (percentage < 60) verdict = "half-built";
  else if (percentage < 85) verdict = "mostly-done";
  else verdict = "shippable";

  return {
    percentage,
    verdict,
    builtCount: Math.max(0, total - stubbed),
    stubbedCount: stubbed,
    totalFunctions: total,
    evidence,
  };
}

// ── Recommendation ranking ─────────────────────────────────────────────────

/**
 * Higher is better. Base: 2*market - effort, plus hours/completion/failure adjustments.
 * Scale roughly -10..20 so sorts stay stable.
 */
export function recommendationScore(r: RecommendationScores): number {
  const effort = clampScore1to5(r.effort);
  const market = clampScore1to5(r.market_potential);
  let score = market * 2 - effort;

  // Prefer concrete, finishable work when hours are known
  const hours = r.estimated_hours;
  if (hours != null && Number.isFinite(hours) && hours > 0) {
    if (hours <= 8) score += 1.5;
    else if (hours <= 24) score += 1;
    else if (hours <= 40) score += 0.5;
    else if (hours > 120) score -= 1;
    else if (hours > 80) score -= 0.5;
  }

  // Structural completion boosts "finish" candidates that are close to done
  if (r.completion_pct != null && Number.isFinite(r.completion_pct)) {
    const c = clampPct(r.completion_pct);
    if (r.kind === "finish") {
      if (c >= 70) score += 1.5;
      else if (c >= 50) score += 0.75;
      else if (c < 20) score -= 1.25;
      else if (c < 35) score -= 0.5;
    } else if (r.kind === "repurpose" && c >= 60) {
      score += 0.5;
    }
  }

  // Learning: demote patterns/repos that repeatedly failed
  if (r.failure_penalty && r.failure_penalty > 0) {
    score -= Math.min(3, r.failure_penalty * 0.75);
  }

  // Slight preference for finish over pure combine when scores tie-ish
  if (r.kind === "finish") score += 0.15;
  else if (r.kind === "repurpose") score += 0.05;

  return score;
}

export function rankRecommendations<T extends RecommendationScores>(items: T[]): T[] {
  return [...items]
    .map((item, originalIndex) => ({ item, originalIndex, s: recommendationScore(item) }))
    .sort((a, b) => b.s - a.s || a.originalIndex - b.originalIndex)
    .map((x) => x.item);
}

// ── Valuation calibration ──────────────────────────────────────────────────

export interface CostReplacementInput {
  estimatedHours: number | null | undefined;
  /** 0–100 completion; unfinished work reduces replacement value of existing code */
  completionPct?: number | null;
  hourlyRateUsd?: number;
  marketPotential?: number | null;
  stars?: number;
  hasRevenueSignals?: boolean;
}

/**
 * Deterministic cost-replacement floor/ceiling used to calibrate AI dollar ranges.
 * Most side projects stay in the low tens of thousands unless traction exists.
 */
export function costReplacementBounds(input: CostReplacementInput): {
  floor: number;
  ceiling: number;
  midpoint: number;
} {
  const rate = input.hourlyRateUsd ?? 75;
  const hours = Math.max(0, input.estimatedHours ?? 40);
  const completion = (input.completionPct ?? 50) / 100;
  // Value of code already written ≈ hours_invested * completion * rate * build_premium
  const investedHours = hours / Math.max(0.15, 1 - completion * 0.5); // rough total project hours
  const raw = investedHours * completion * rate * 1.2;

  const market = input.marketPotential ?? 3;
  const marketMult = 0.6 + market * 0.25; // 0.85 .. 1.85
  const starBoost = Math.min(1.5, 1 + Math.log10(Math.max(1, (input.stars ?? 0) + 1)) * 0.15);

  let mid = raw * marketMult * starBoost;
  if (input.hasRevenueSignals) mid *= 1.4;

  // Sanity clamps for indie portfolio tooling
  mid = clamp(mid, 500, 5_000_000);
  const floor = Math.round(mid * 0.45);
  const ceiling = Math.round(mid * 2.2);
  return { floor, ceiling, midpoint: Math.round(mid) };
}

/**
 * Blend AI valuation with deterministic cost-replacement bounds.
 * Prevents absurd AI highs when confidence is low and lifts floors when code is substantial.
 */
export function calibrateValuationRange(
  aiLow: number,
  aiHigh: number,
  bounds: { floor: number; ceiling: number; midpoint: number },
  confidence: "low" | "medium" | "high" = "medium",
): { low: number; high: number; method_note: string } {
  let low = Math.max(0, aiLow || 0);
  let high = Math.max(low, aiHigh || 0);

  // Weight toward deterministic bounds when confidence is low
  const aiWeight = confidence === "high" ? 0.75 : confidence === "medium" ? 0.55 : 0.35;
  const detWeight = 1 - aiWeight;

  low = Math.round(low * aiWeight + bounds.floor * detWeight);
  high = Math.round(high * aiWeight + bounds.ceiling * detWeight);

  // Cap runaway AI vs cost-replacement (stronger when confidence is low)
  const maxMult = confidence === "high" ? 8 : confidence === "medium" ? 5 : 3;
  const maxHigh = Math.max(bounds.ceiling * maxMult, bounds.midpoint * maxMult, 5_000);
  const maxLow = Math.max(bounds.floor * maxMult, bounds.midpoint * (maxMult * 0.5), 1_000);

  if (high > maxHigh) high = Math.round(maxHigh);
  if (low > maxLow) low = Math.round(maxLow);

  // Floor: don't collapse below a fraction of cost-replacement when AI is tiny
  if (low < bounds.floor * 0.25 && bounds.floor > 0 && (aiLow || 0) > 0) {
    low = Math.round(bounds.floor * 0.25);
  }

  low = clamp(low, 0, 10_000_000);
  high = clamp(high, 0, 15_000_000);

  // Ensure a usable range (at least $500 span)
  if (high < low + 500) {
    high = low + Math.max(500, Math.round(low * 0.2));
  }

  return {
    low: Math.round(low),
    high: Math.round(high),
    method_note: `Blended AI estimate with cost-replacement bounds ($${bounds.floor.toLocaleString()}–$${bounds.ceiling.toLocaleString()}) at ${confidence} confidence`,
  };
}

export function diversificationScore(
  revenueModels: string[],
  kinds?: string[],
): number {
  if (revenueModels.length === 0) return 0;
  const models = new Set(
    revenueModels.map((m) => m.toLowerCase().trim()).filter(Boolean),
  );
  const kindSet = new Set((kinds ?? []).map((k) => k.toLowerCase()));
  const modelPart = (models.size / Math.max(revenueModels.length, 1)) * 7;
  const kindPart = Math.min(3, kindSet.size);
  return clamp(Math.round(modelPart + kindPart), 0, 10);
}

export function portfolioRecommendation(totalHigh: number, avgConfidence?: string): string {
  const confNote =
    avgConfidence === "low"
      ? " Estimates are low-confidence — treat as directional only."
      : "";
  if (totalHigh > 500_000) {
    return (
      "Strong portfolio — consider doubling down on top picks and seeking acquisition interest." +
      confNote
    );
  }
  if (totalHigh > 100_000) {
    return (
      "Promising portfolio — focus on finishing highest-value repos and monetizing." + confNote
    );
  }
  if (totalHigh > 25_000) {
    return (
      "Developing portfolio — prioritize one near-shippable repo to create a reference win." +
      confNote
    );
  }
  return (
    "Early-stage portfolio — most value is in development cost savings. Focus on finishing and launching." +
    confNote
  );
}

/** Sample source paths with directory diversity (not only largest files). */
export function sampleSourceFiles<T extends { path: string; size?: number }>(
  files: T[],
  limit = 20,
): T[] {
  if (files.length <= limit) return [...files];

  const byDir = new Map<string, T[]>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") : ".";
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }
  for (const [, list] of byDir) {
    list.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  }

  const picked: T[] = [];
  const dirs = [...byDir.keys()].sort();
  // Round-robin across directories
  let guard = 0;
  while (picked.length < limit && guard < limit * dirs.length + 5) {
    for (const d of dirs) {
      const list = byDir.get(d);
      if (list && list.length > 0 && picked.length < limit) {
        picked.push(list.shift()!);
      }
    }
    guard++;
  }

  // If still short, fill by global size
  if (picked.length < limit) {
    const remaining = files
      .filter((f) => !picked.includes(f))
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    for (const f of remaining) {
      if (picked.length >= limit) break;
      picked.push(f);
    }
  }

  return picked;
}

/** Parse Link header / naive commit count from GitHub commits API. */
export function estimateCommitCountFromResponse(
  commitsLength: number,
  linkHeader: string | null,
): number {
  if (!linkHeader) return commitsLength;
  // rel="last" page=N
  const m = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (m) {
    const lastPage = parseInt(m[1], 10);
    // per_page default 30 unless we set 100
    const perPageMatch = linkHeader.match(/[?&]per_page=(\d+)/);
    const perPage = perPageMatch ? parseInt(perPageMatch[1], 10) : 30;
    return lastPage * perPage;
  }
  return commitsLength;
}
