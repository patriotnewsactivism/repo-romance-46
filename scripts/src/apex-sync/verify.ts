import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { FileChange, Incident } from "./types.js";

export interface CmdResult {
  code: number;
  output: string;
}
export type RunCmd = (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;

const MAX_FILES = 8;
const MAX_BYTES = 200_000;
const DENY = [/^\.github\//, /(^|\/)package\.json$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)\.env/, /(^|\/)node_modules\//, /^\.git\//];
const TEST_RE = /\.test\.ts$/;

export type ChangeCheck =
  | { ok: true; testFiles: FileChange[]; sourceFiles: FileChange[] }
  | { ok: false; reason: string };

/** Package root = everything before the first `/src/` (e.g. packages/api-server). */
export function packageDir(path: string): string | undefined {
  const i = path.indexOf("/src/");
  return i > 0 ? path.slice(0, i) : undefined;
}

export function checkChanges(changes: FileChange[], incident: Pick<Incident, "files">): ChangeCheck {
  if (changes.length === 0) return { ok: false, reason: "no_changes_returned" };
  if (changes.length > MAX_FILES) return { ok: false, reason: "too_many_files" };
  const allowed = new Set(incident.files);
  const allowedPkgs = new Set(incident.files.map(packageDir).filter((p): p is string => !!p));
  const testFiles: FileChange[] = [];
  const sourceFiles: FileChange[] = [];
  for (const c of changes) {
    const p = c.path;
    if (!p || p.startsWith("/") || p.includes("\\") || posix.normalize(p) !== p || p.split("/").includes("..")) {
      return { ok: false, reason: `unsafe_path:${p}` };
    }
    if (DENY.some((re) => re.test(p))) return { ok: false, reason: `denied_path:${p}` };
    if (c.content.length > MAX_BYTES) return { ok: false, reason: `file_too_large:${p}` };
    if (TEST_RE.test(p)) {
      const pkg = packageDir(p);
      if (!pkg || !allowedPkgs.has(pkg)) return { ok: false, reason: `test_outside_package:${p}` };
      testFiles.push(c);
    } else if (allowed.has(p)) {
      sourceFiles.push(c);
    } else {
      return { ok: false, reason: `file_not_in_plan:${p}` };
    }
  }
  if (testFiles.length === 0) return { ok: false, reason: "no_regression_test" };
  if (sourceFiles.length === 0) return { ok: false, reason: "no_source_change" };
  return { ok: true, testFiles, sourceFiles };
}

const tail = (s: string, n = 1500) => (s.length > n ? s.slice(-n) : s);
const NO_TESTS = /no test files found|no tests found|cannot find module|failed to resolve import/i;

function write(root: string, files: FileChange[]): void {
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
}

export interface VerifyEvidence {
  beforeExit?: number;
  beforeTail?: string;
  afterExit?: number;
  afterTail?: string;
  typecheckExit?: number;
  typecheckTail?: string;
}
export type VerifyResult =
  | { ok: true; evidence: VerifyEvidence; changes: FileChange[] }
  | { ok: false; reason: string; evidence: VerifyEvidence };

/**
 * The only authority on correctness. Order matters:
 *  1. only the regression test(s) applied  -> must FAIL (and not merely fail to load)
 *  2. full patch applied                   -> test(s) must PASS
 *  3. package typecheck                    -> must PASS
 * The clone is restored between steps so a leaked file can't make step 1 pass for the wrong reason.
 */
export async function verifyPatch(
  cloneDir: string,
  changes: FileChange[],
  incident: Pick<Incident, "files">,
  run: RunCmd,
): Promise<VerifyResult> {
  const evidence: VerifyEvidence = {};
  const check = checkChanges(changes, incident);
  if (!check.ok) return { ok: false, reason: check.reason, evidence };

  const pkg = packageDir(check.testFiles[0]!.path)!;
  const rel = (p: string) => p.slice(pkg.length + 1);
  const testArgs = ["-C", join(cloneDir, pkg), "exec", "vitest", "run", ...check.testFiles.map((t) => rel(t.path))];
  const restore = async () => {
    await run("git", ["checkout", "--", "."], cloneDir);
    await run("git", ["clean", "-fdq", "--", ...check.testFiles.map((t) => t.path)], cloneDir);
  };

  write(cloneDir, check.testFiles);
  const before = await run("pnpm", testArgs, cloneDir);
  evidence.beforeExit = before.code;
  evidence.beforeTail = tail(before.output);
  await restore();
  if (before.code === 0) return { ok: false, reason: "test_passes_on_base", evidence };
  if (NO_TESTS.test(before.output)) return { ok: false, reason: "test_did_not_run_on_base", evidence };

  write(cloneDir, [...check.sourceFiles, ...check.testFiles]);
  const after = await run("pnpm", testArgs, cloneDir);
  evidence.afterExit = after.code;
  evidence.afterTail = tail(after.output);
  if (after.code !== 0) return { ok: false, reason: "test_fails_with_patch", evidence };

  const tc = await run("pnpm", ["-C", join(cloneDir, pkg), "run", "typecheck"], cloneDir);
  evidence.typecheckExit = tc.code;
  evidence.typecheckTail = tail(tc.output);
  if (tc.code !== 0) return { ok: false, reason: "typecheck_failed", evidence };

  return { ok: true, evidence, changes: [...check.sourceFiles, ...check.testFiles] };
}

export function readFiles(root: string, paths: string[]): FileChange[] {
  return paths.map((p) => ({ path: p, content: readFileSync(join(root, p), "utf8") }));
}
