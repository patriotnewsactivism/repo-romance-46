import { DEFAULT_GATE, type GateConfig, gate, recordDebate, recordOutcome } from "./ledger.js";
import { buildPayload, renderDebateInput } from "./plan.js";
import { signatureOf } from "./signature.js";
import type { FileChange, Incident, Ledger, Outcome } from "./types.js";
import type { VerifyResult } from "./verify.js";

/** Every side effect is injected so the control flow is testable without network or git. */
export interface LoopDeps {
  now: () => Date;
  observe: () => Promise<Incident[]>;
  countOpenPrs: () => Promise<number>;
  prepareWorkspace: () => Promise<{ dir: string; readFiles: (paths: string[]) => FileChange[] }>;
  thinkTank: (input: string, customContext: string) => Promise<{ sessionId: string; changes: FileChange[] }>;
  verify: (dir: string, changes: FileChange[], incident: Incident) => Promise<VerifyResult>;
  openPr: (dir: string, incident: Incident, traceId: string, v: Extract<VerifyResult, { ok: true }>, sessionId: string) => Promise<string>;
  saveLedger: (l: Ledger) => void;
  log: (msg: string) => void;
}

export interface LoopConfig {
  live: boolean;
  gate?: GateConfig;
  maxAttempts?: number;
}

export async function runLoop(deps: LoopDeps, ledgerIn: Ledger, cfg: LoopConfig): Promise<Outcome> {
  const gateCfg = cfg.gate ?? DEFAULT_GATE;
  let ledger = ledgerIn;
  const now = deps.now();

  const incidents = await deps.observe();
  const incident = incidents[0];
  if (!incident) return { verdict: "NO_SIGNAL", reason: "no_incident" };

  const signature = signatureOf(incident);
  const traceId = `apex-sync-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${signature.slice(0, 6)}`;
  const base = { signature, traceId };

  const blocked = (reason: string, evidence?: Record<string, unknown>): Outcome => {
    ledger = recordOutcome(ledger, { signature, status: "blocked", at: deps.now().toISOString(), reason });
    deps.saveLedger(ledger);
    return { verdict: "BLOCKED", reason, ...base, ...(evidence ? { evidence } : {}) };
  };

  if (incident.files.length === 0) return blocked("no_files_in_scope");

  const decision = gate(ledger, signature, now, await deps.countOpenPrs(), gateCfg);
  if (!decision.allow) return { verdict: "SKIPPED", reason: decision.reason, ...base };

  const payload = buildPayload(incident, traceId);
  if (!cfg.live) {
    deps.log(`[dry-run] would debate: ${JSON.stringify(payload)}`);
    return { verdict: "SKIPPED", reason: "dry_run", ...base, evidence: { payload } };
  }

  const ws = await deps.prepareWorkspace();
  let original: FileChange[];
  try {
    original = ws.readFiles(incident.files);
  } catch (err) {
    return blocked(`unreadable_files_in_scope:${err instanceof Error ? err.message : String(err)}`);
  }

  const maxAttempts = cfg.maxAttempts ?? 2;
  let priorFailure: string | undefined;
  let lastReason = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Spend is accounted BEFORE the call so a crash mid-debate still counts against the cap.
    ledger = recordDebate(ledger, deps.now());
    deps.saveLedger(ledger);

    const { input, customContext } = renderDebateInput(payload, original, incident.files, priorFailure);
    let result: { sessionId: string; changes: FileChange[] };
    try {
      result = await deps.thinkTank(input, customContext);
    } catch (err) {
      return blocked(`thinktank_error:${err instanceof Error ? err.message : String(err)}`);
    }

    const v = await deps.verify(ws.dir, result.changes, incident);
    if (v.ok) {
      const prUrl = await deps.openPr(ws.dir, incident, traceId, v, result.sessionId);
      ledger = recordOutcome(ledger, { signature, status: "pr_opened", at: deps.now().toISOString(), prUrl });
      deps.saveLedger(ledger);
      return { verdict: "VERIFIED", reason: "tests_fail_before_pass_after", ...base, prUrl, evidence: { ...v.evidence, attempt, thinkTankRun: result.sessionId } };
    }
    lastReason = v.reason;
    deps.log(`attempt ${attempt} failed verification: ${v.reason}`);
    const tailFor = v.reason === "typecheck_failed" ? v.evidence.typecheckTail : (v.evidence.afterTail ?? v.evidence.beforeTail);
    priorFailure = [v.reason, tailFor ?? ""].join("\n").slice(0, 1500);
    const overCap = ledger.debateCount >= gateCfg.dailyDebateCap;
    if (overCap) break;
  }
  return blocked(`verification_failed:${lastReason}`);
}
