/**
 * Deterministic static analysis primitives.
 *
 * RESTORED from `.migration-backup/src/lib/scoring.ts` (stub detection and
 * brace-aware function counting), which was stranded when the app moved to the
 * pnpm monorepo. The logic is intentionally unchanged where it was already
 * correct; only the module boundary and typing changed so scoring can consume
 * it without importing the old Vite-era app.
 */

import type { StubHit, StubKind } from "./types";

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
    const line = lines[i] ?? "";
    for (const { pattern, kind } of STUB_PATTERNS) {
      if (pattern.test(line)) {
        stubs.push({ file: filePath, line: i + 1, kind, snippet: line.trim().slice(0, 120) });
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

  // Prefer the family with the most matches (a repo is usually one primary language)
  const candidates = [jsLike, py, rs, go];
  candidates.sort((a, b) => b.total - a.total);
  const best = candidates[0] ?? { total: 0, stubbed: 0 };
  return { total: best.total, stubbed: Math.min(best.stubbed, best.total) };
}

function countSimpleDefs(content: string, pattern: RegExp): { total: number; stubbed: number } {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = content.match(new RegExp(pattern.source, flags));
  const total = matches?.length ?? 0;
  const stubMarkers = (
    content.match(/\bNotImplementedError\b|\bunimplemented!\(\)|\btodo!\(\)|\bpass\s*#\s*(todo|stub)/gi) ?? []
  ).length;
  return { total, stubbed: Math.min(stubMarkers, total) };
}

function countJsLikeFunctions(content: string): { total: number; stubbed: number } {
  const starts: number[] = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/g,
    /(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/g,
    /(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?function\s*\(/g,
  ];

  for (const re of patterns) {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) starts.push(m.index);
  }

  // Class methods: indent + name( + ) { — skip control-flow keywords
  const methodRe =
    /^[ \t]+(?:async\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(content)) !== null) {
    const name = mm[1];
    if (name === "if" || name === "for" || name === "while" || name === "switch" || name === "catch") continue;
    starts.push(mm.index);
  }

  // Dedupe starts within 5 chars (overlapping patterns)
  starts.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const idx of starts) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || idx - last > 5) deduped.push(idx);
  }

  let stubbed = 0;
  for (const idx of deduped) if (isStubBodyAfter(content, idx)) stubbed++;

  return { total: deduped.length, stubbed };
}

function isStubBodyAfter(content: string, startIdx: number): boolean {
  const slice = content.slice(startIdx, startIdx + 800);
  const brace = slice.indexOf("{");
  const arrow = slice.search(/=>/);

  // Arrow with concise body: `=> null` / `=> undefined` / `=> {}`
  if (arrow !== -1 && (brace === -1 || arrow < brace)) {
    const afterArrow = slice.slice(arrow + 2).trimStart();
    if (/^(null|undefined|void 0|''|""|``|\{\}|\[\])\s*;?/.test(afterArrow)) return true;
    if (afterArrow.startsWith("{")) return isEmptyOrStubBlock(afterArrow);
    return false;
  }

  if (brace === -1) return false;
  return isEmptyOrStubBlock(slice.slice(brace));
}

function isEmptyOrStubBlock(fromBrace: string): boolean {
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
  for (const re of STUB_BODY_LINE) {
    if (re.test(body) || re.test(body.split("\n")[0] ?? "")) return true;
  }
  if (/^return\s*(null|undefined|void 0|''|""|``|\{\}|\[\])\s*;?$/.test(body)) return true;
  if (/^throw\s+new\s+Error\s*\(\s*['"`](not implemented|TODO|FIXME)/i.test(body)) return true;
  if (body.length < 80 && /\b(TODO|FIXME|not implemented)\b/i.test(body)) return true;
  return false;
}

/** Bare package specifiers imported by an ES/TS module, deduped and sorted. */
export function extractImports(content: string): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  const specRe = /(?:^|\s)(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]/g;
  const bareImportRe = /(?:^|\s)import\s*['"]([^'"]+)['"]/g;
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [specRe, bareImportRe, requireRe, dynamicRe]) {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/") || spec.startsWith("~/")) {
        internal.add(spec);
      } else {
        // Normalize `pkg/sub/path` → `pkg` (and `@scope/pkg/sub` → `@scope/pkg`)
        const parts = spec.split("/");
        external.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec));
      }
    }
  }

  return { internal: [...internal].sort(), external: [...external].sort() };
}

/** Exported symbol names declared in an ES/TS module. */
export function extractExports(content: string): string[] {
  const names = new Set<string>();
  // `export default class G {}` exports only `default` — G is not importable
  // by name, so the `default` keyword deliberately breaks this match.
  const declRe =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(content)) !== null) if (m[1]) names.add(m[1]);

  const listRe = /export\s*\{([^}]*)\}/g;
  while ((m = listRe.exec(content)) !== null) {
    for (const raw of (m[1] ?? "").split(",")) {
      const cleaned = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (cleaned && /^\w+$/.test(cleaned)) names.add(cleaned);
    }
  }

  if (/export\s+default\b/.test(content)) names.add("default");
  return [...names].sort();
}

/** Environment variable names referenced in source. */
export function extractEnvRefs(content: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g,
    /import\.meta\.env\.([A-Z0-9_]+)/g,
    /\bos\.environ(?:\.get)?[[(]\s*['"]([A-Z0-9_]+)['"]/g,
  ];
  for (const re of patterns) {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) if (m[1]) names.add(m[1]);
  }
  return [...names].sort();
}

/** HTTP routes registered by common Node server frameworks. */
export function extractApiRoutes(content: string): string[] {
  const routes = new Set<string>();
  const re = /\b(?:app|router|api|server)\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const path = m[2];
    if (path && path.startsWith("/")) routes.add(`${(m[1] ?? "").toUpperCase()} ${path}`);
  }
  return [...routes].sort();
}

/** Client-side routes declared by common React routers. */
export function extractFrontendRoutes(content: string): string[] {
  const routes = new Set<string>();
  const patterns = [/<Route\s[^>]*path\s*=\s*["'{]([^"'}]+)["'}]/g, /\bpath\s*:\s*['"]([^'"]+)['"]/g];
  for (const re of patterns) {
    const r = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) {
      const path = m[1];
      if (path && path.startsWith("/")) routes.add(path);
    }
  }
  return [...routes].sort();
}
