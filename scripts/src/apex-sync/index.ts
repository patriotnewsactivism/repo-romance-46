import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLedger } from "./ledger.js";
import { runLoop, type LoopDeps } from "./loop.js";
import { observeApex } from "./observe.js";
import { BRANCH_PREFIX, countOpenAutoFixPrs, gitAuthEnvArgs, openDraftPr } from "./pr.js";
import { runThinkTank } from "./thinktank.js";
import type { Incident, Outcome } from "./types.js";
import { readFiles, verifyPatch, type CmdResult, type RunCmd } from "./verify.js";

const here = dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || fallback;
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

export const run: RunCmd = (cmd, args, cwd) =>
  new Promise<CmdResult>((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let output = "";
    const cap = (b: Buffer) => { output = (output + b.toString()).slice(-20_000); };
    p.stdout.on("data", cap);
    p.stderr.on("data", cap);
    p.on("error", (e) => resolve({ code: 127, output: String(e) }));
    p.on("close", (code) => resolve({ code: code ?? 1, output }));
  });

function parseOverride(raw: string | undefined): Incident[] | undefined {
  if (!raw?.trim()) return undefined;
  const o = JSON.parse(raw) as Partial<Incident>;
  if (!o.component || !o.errorSignature || !Array.isArray(o.files) || o.files.length === 0) {
    throw new Error("incident_override needs component, errorSignature and a non-empty files[]");
  }
  return [{ severity: o.severity ?? "P2", component: o.component, errorSignature: o.errorSignature, files: o.files, ...(o.testPath ? { testPath: o.testPath } : {}) }];
}

function summary(o: Outcome): string {
  return [`## Apex ↔ Think Tank sync: ${o.verdict}`, `- reason: \`${o.reason}\``, o.traceId ? `- trace: \`${o.traceId}\`` : "", o.prUrl ? `- draft PR: ${o.prUrl}` : "", "", "```json", JSON.stringify(o.evidence ?? {}, null, 2), "```"].filter(Boolean).join("\n");
}

export async function main(): Promise<number> {
  const live = process.env.APEX_SYNC_LIVE === "true";
  const repo = env("APEX_REPO", "patriotnewsactivism/Apex");
  const repoToken = live ? env("APEX_REPO_TOKEN") : process.env.APEX_REPO_TOKEN?.trim() ?? "";
  const ledgerPath = env("APEX_SYNC_LEDGER", ".apex-sync/ledger.json");
  const thinkTank = env("THINKTANK_ENDPOINT", "https://debate.donmatthews.live");
  const mapPath = join(here, "component-map.json");
  const componentFiles = existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string[]>) : {};
  const override = parseOverride(process.env.INCIDENT_OVERRIDE);
  const ledger = loadLedger(ledgerPath);
  const { saveLedger } = await import("./ledger.js");

  const deps: LoopDeps = {
    now: () => new Date(),
    observe: async () => override ?? observeApex({ baseUrl: env("APEX_BASE_URL"), token: env("APEX_API_KEY"), componentFiles }),
    countOpenPrs: async () => (repoToken ? countOpenAutoFixPrs(repo, repoToken) : 0),
    prepareWorkspace: async () => {
      const dir = mkdtempSync(join(tmpdir(), "apex-"));
      const clone = await run("git", [...gitAuthEnvArgs(repoToken), "clone", "--depth", "50", `https://github.com/${repo}.git`, dir], tmpdir());
      if (clone.code !== 0) throw new Error(`clone failed: ${clone.output.replaceAll(repoToken, "***").slice(-300)}`);
      const install = await run("pnpm", ["install", "--frozen-lockfile"], dir);
      if (install.code !== 0) throw new Error(`apex dependency install failed: ${install.output.slice(-300)}`);
      return { dir, readFiles: (paths) => readFiles(dir, paths) };
    },
    thinkTank: (input, customContext) => runThinkTank({ endpoint: thinkTank, input, customContext, maxRounds: 2 }),
    verify: (dir, changes, incident) => verifyPatch(dir, changes, incident, run),
    openPr: async (dir, incident, traceId, v, sessionId) => {
      const branch = `${BRANCH_PREFIX}${traceId.replace(/^apex-sync-/, "")}`;
      const body = [
        `Automated draft from the Apex ↔ Think Tank loop (trace \`${traceId}\`).`, "",
        `**Incident:** ${incident.severity} \`${incident.component}\` — ${incident.errorSignature}`,
        `**Think Tank run:** \`${sessionId}\` (advisory only; not proof)`, "",
        "**Verification (run locally, not by debate consensus):**",
        `- regression test exit before patch: \`${v.evidence.beforeExit}\` (must be non-zero)`,
        `- regression test exit with patch: \`${v.evidence.afterExit}\` (must be 0)`,
        `- package typecheck exit: \`${v.evidence.typecheckExit}\``, "",
        "Draft only: review, let CI run, and merge manually.",
      ].join("\n");
      return openDraftPr({ repo, token: repoToken, cloneDir: dir, baseBranch: "main", branch, title: `fix(auto-heal): ${incident.component} ${incident.severity}`, body, changes: v.changes, run });
    },
    saveLedger: (l) => saveLedger(ledgerPath, l),
    log: (m) => console.log(m),
  };

  const outcome = await runLoop(deps, ledger, { live });
  console.log(JSON.stringify(outcome));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary(outcome)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => process.exit(c), (err) => {
    console.error(`apex-sync failed closed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
