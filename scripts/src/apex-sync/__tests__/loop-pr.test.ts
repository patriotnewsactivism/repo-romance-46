import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyLedger, recordOutcome } from "../ledger.js";
import { runLoop, type LoopDeps } from "../loop.js";
import { countOpenAutoFixPrs, openDraftPr } from "../pr.js";
import { signatureOf } from "../signature.js";
import type { FileChange, Incident, Ledger } from "../types.js";
import type { VerifyResult } from "../verify.js";

const incident: Incident = { severity: "P1", component: "tasks", errorSignature: "silent cancel", files: ["packages/api-server/src/routes/tasks.ts"] };
const changes: FileChange[] = [{ path: "x", content: "y" }];
const okV: VerifyResult = { ok: true, changes, evidence: { beforeExit: 1, afterExit: 0, typecheckExit: 0 } };

function harness(over: Partial<LoopDeps> = {}) {
  const calls = { thinkTank: 0, prepare: 0, openPr: 0, saves: [] as Ledger[] };
  const deps: LoopDeps = {
    now: () => new Date("2026-10-19T12:00:00Z"),
    observe: async () => [incident],
    countOpenPrs: async () => 0,
    prepareWorkspace: async () => { calls.prepare++; return { dir: "/d", readFiles: (p) => p.map((path) => ({ path, content: "orig" })) }; },
    thinkTank: async () => { calls.thinkTank++; return { sessionId: "9", changes }; },
    verify: async () => okV,
    openPr: async () => { calls.openPr++; return "https://github.com/o/r/pull/1"; },
    saveLedger: (l) => calls.saves.push(l),
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

describe("runLoop", () => {
  it("NO_SIGNAL when Apex reports nothing", async () => {
    const { deps, calls } = harness({ observe: async () => [] });
    assert.equal((await runLoop(deps, emptyLedger(), { live: true })).verdict, "NO_SIGNAL");
    assert.equal(calls.thinkTank, 0);
  });
  it("BLOCKED before any spend when no files are in scope", async () => {
    const { deps, calls } = harness({ observe: async () => [{ ...incident, files: [] }] });
    const o = await runLoop(deps, emptyLedger(), { live: true });
    assert.deepEqual([o.verdict, o.reason], ["BLOCKED", "no_files_in_scope"]);
    assert.equal(calls.thinkTank, 0);
    assert.equal(calls.prepare, 0);
  });
  it("dry run never clones, debates or opens a PR", async () => {
    const { deps, calls } = harness();
    const o = await runLoop(deps, emptyLedger(), { live: false });
    assert.deepEqual([o.verdict, o.reason], ["SKIPPED", "dry_run"]);
    assert.deepEqual([calls.thinkTank, calls.prepare, calls.openPr], [0, 0, 0]);
  });
  it("gated signatures and open-PR cap cost zero LLM calls", async () => {
    const sig = signatureOf(incident);
    const led = recordOutcome(emptyLedger(), { signature: sig, status: "blocked", at: "2026-10-19T11:00:00Z" });
    const a = harness();
    assert.equal((await runLoop(a.deps, led, { live: true })).reason, "blocked_cooldown");
    const b = harness({ countOpenPrs: async () => 1 });
    assert.equal((await runLoop(b.deps, emptyLedger(), { live: true })).reason, "open_pr_cap");
    assert.equal(a.calls.thinkTank + b.calls.thinkTank, 0);
  });
  it("VERIFIED opens exactly one draft PR and records it", async () => {
    const { deps, calls } = harness();
    const o = await runLoop(deps, emptyLedger(), { live: true });
    assert.deepEqual([o.verdict, o.prUrl, calls.openPr], ["VERIFIED", "https://github.com/o/r/pull/1", 1]);
    assert.equal(calls.saves.at(-1)!.entries.at(-1)!.status, "pr_opened");
  });
  it("Think Tank failure is BLOCKED, ledgered, and not retried", async () => {
    const { deps, calls } = harness({ thinkTank: async () => { throw new Error("timed out"); } });
    const o = await runLoop(deps, emptyLedger(), { live: true });
    assert.match(o.reason, /thinktank_error/);
    assert.equal(calls.openPr, 0);
    assert.equal(calls.saves.at(-1)!.entries.at(-1)!.status, "blocked");
    assert.equal(calls.saves.at(-1)!.debateCount, 1);
  });
  it("one revision pass after a failed verification, then success", async () => {
    let n = 0;
    const seen: string[] = [];
    const { deps, calls } = harness({
      verify: async () => (++n === 1 ? { ok: false, reason: "test_fails_with_patch", evidence: { afterTail: "boom" } } : okV),
      thinkTank: async (input) => { seen.push(input); return { sessionId: "9", changes }; },
    });
    const o = await runLoop(deps, emptyLedger(), { live: true });
    assert.equal(o.verdict, "VERIFIED");
    assert.match(seen[1]!, /previous attempt FAILED[\s\S]*boom/);
    assert.equal(calls.saves.filter((l) => l.debateCount > 0).at(-1)!.debateCount, 2);
  });
  it("gives up after two failed attempts and never opens a PR", async () => {
    const { deps, calls } = harness({ verify: async () => ({ ok: false, reason: "typecheck_failed", evidence: {} }) });
    const o = await runLoop(deps, emptyLedger(), { live: true });
    assert.deepEqual([o.verdict, o.reason, calls.thinkTank, calls.openPr], ["BLOCKED", "verification_failed:typecheck_failed", 2, 0]);
  });
  it("stops retrying when the daily cap is reached mid-run", async () => {
    const { deps, calls } = harness({ verify: async () => ({ ok: false, reason: "x", evidence: {} }) });
    const o = await runLoop(deps, { ...emptyLedger(), debateDay: "2026-10-19", debateCount: 3 }, { live: true });
    assert.equal(o.verdict, "BLOCKED");
    assert.equal(calls.thinkTank, 1);
  });
});

describe("pr", () => {
  it("counts only fix/apex-* open PRs", async () => {
    const f = (async () => new Response(JSON.stringify([{ head: { ref: "fix/apex-1" } }, { head: { ref: "feature/x" } }]))) as unknown as typeof fetch;
    assert.equal(await countOpenAutoFixPrs("o/r", "t", f), 1);
  });
  it("refuses branches outside fix/apex-*", async () => {
    await assert.rejects(openDraftPr({ repo: "o/r", token: "t", cloneDir: "/d", baseBranch: "main", branch: "main", title: "t", body: "b", changes, run: async () => ({ code: 0, output: "" }) }), /Refusing branch/);
  });
  it("opens a draft PR and keeps the token out of errors", async () => {
    const cmds: string[][] = [];
    let body: Record<string, unknown> = {};
    const f = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ html_url: "https://github.com/o/r/pull/7" }), { status: 201 }); }) as unknown as typeof fetch;
    const url = await openDraftPr({ repo: "o/r", token: "SECRET", cloneDir: "/d", baseBranch: "main", branch: "fix/apex-1", title: "t", body: "b", changes, run: async (_c, a) => { cmds.push(a); return { code: 0, output: "" }; }, fetchImpl: f });
    assert.equal(url, "https://github.com/o/r/pull/7");
    assert.equal(body.draft, true);
    assert.ok(cmds.some((a) => a.includes("push")));
    await assert.rejects(
      openDraftPr({ repo: "o/r", token: "SECRET", cloneDir: "/d", baseBranch: "main", branch: "fix/apex-1", title: "t", body: "b", changes, run: async (_c, a) => (a.includes("push") ? { code: 1, output: "fatal: auth SECRET failed" } : { code: 0, output: "" }) }),
      (e: Error) => !e.message.includes("SECRET"),
    );
  });
});
