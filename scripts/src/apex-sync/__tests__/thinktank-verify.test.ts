import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { baseUrl, runThinkTank, ThinkTankError } from "../thinktank.js";
import { checkChanges, verifyPatch, type RunCmd } from "../verify.js";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const opts = { endpoint: "https://tt.test/api/debate", input: "i", customContext: "c", sleep: async () => {} };

describe("thinktank adapter", () => {
  it("normalizes the pasted /api/debate endpoint", () => assert.equal(baseUrl("https://tt.test/api/debate/"), "https://tt.test"));

  it("starts, polls until complete, then reads changes", async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/debate")) return json({ sessionId: "123" });
      if (url.endsWith("/runs/123")) return json({ status: ++polls < 2 ? "running" : "complete" });
      return json({ changes: [{ path: "a.ts", content: "x", action: "MODIFIED" }] });
    }) as unknown as typeof fetch;
    const r = await runThinkTank({ ...opts, fetchImpl: f });
    assert.deepEqual(r, { sessionId: "123", changes: [{ path: "a.ts", content: "x" }] });
    assert.equal(polls, 2);
    assert.equal(calls[0], "POST https://tt.test/api/debate");
  });

  it("sends no credentials and clamps maxRounds to 2", async () => {
    let sent: Record<string, unknown> = {};
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { sent = JSON.parse(String(init.body)); return json({ sessionId: "1" }); }
      return url.includes("export") ? json({ changes: [] }) : json({ status: "complete" });
    }) as unknown as typeof fetch;
    await runThinkTank({ ...opts, maxRounds: 8, fetchImpl: f });
    assert.equal(sent.maxRounds, 2);
    assert.deepEqual(Object.keys(sent).sort(), ["customContext", "input", "maxRounds"]);
  });

  it("errors on start failure, run error, bad sessionId, deletions and timeout", async () => {
    await assert.rejects(runThinkTank({ ...opts, fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch }), ThinkTankError);
    const f1 = (async (u: string) => (u.endsWith("/api/debate") ? json({ sessionId: "1" }) : json({ status: "error", error: "model down" }))) as unknown as typeof fetch;
    await assert.rejects(runThinkTank({ ...opts, fetchImpl: f1 }), /model down/);
    await assert.rejects(runThinkTank({ ...opts, fetchImpl: (async () => json({ sessionId: "../x" })) as unknown as typeof fetch }), /sessionId/);
    const f2 = (async (u: string) => (u.endsWith("/api/debate") ? json({ sessionId: "1" }) : u.includes("export") ? json({ changes: [{ path: "a", content: "", action: "DELETE" }] }) : json({ status: "complete" }))) as unknown as typeof fetch;
    await assert.rejects(runThinkTank({ ...opts, fetchImpl: f2 }), /deletions/);
    let t = 0;
    const f3 = (async (u: string) => (u.endsWith("/api/debate") ? json({ sessionId: "1" }) : json({ status: "running" }))) as unknown as typeof fetch;
    await assert.rejects(runThinkTank({ ...opts, fetchImpl: f3, now: () => (t += 400_000), timeoutMs: 600_000 }), /timed out/);
  });
});

const incident = { files: ["packages/api-server/src/routes/tasks.ts"] };
const src = { path: "packages/api-server/src/routes/tasks.ts", content: "fixed" };
const test = { path: "packages/api-server/src/__tests__/tasks-terminal-guard.test.ts", content: "t" };

describe("checkChanges", () => {
  it("accepts planned source + a test in the same package", () => assert.equal(checkChanges([src, test], incident).ok, true));
  const reason = (c: Parameters<typeof checkChanges>[0]) => { const r = checkChanges(c, incident); return r.ok ? "ok" : r.reason; };
  it("rejects unplanned, denied, traversal and absolute paths", () => {
    assert.match(reason([src, test, { path: "packages/api-server/src/other.ts", content: "x" }]), /file_not_in_plan/);
    assert.match(reason([src, test, { path: ".github/workflows/x.yml", content: "x" }]), /denied_path/);
    assert.match(reason([src, test, { path: "packages/api-server/package.json", content: "{}" }]), /denied_path/);
    assert.match(reason([src, { path: "../x.test.ts", content: "x" }]), /unsafe_path/);
    assert.match(reason([src, { path: "/etc/x.test.ts", content: "x" }]), /unsafe_path/);
  });
  it("rejects tests in other packages, missing tests, missing source, empty", () => {
    assert.match(reason([src, { path: "packages/core/src/__tests__/a.test.ts", content: "x" }]), /test_outside_package/);
    assert.equal(reason([src]), "no_regression_test");
    assert.equal(reason([test]), "no_source_change");
    assert.equal(reason([]), "no_changes_returned");
  });
});

describe("verifyPatch", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "vp-"));
  const script = (codes: number[], outputs: string[] = []): { run: RunCmd; log: string[] } => {
    const log: string[] = [];
    let i = 0;
    const run: RunCmd = async (cmd, args) => {
      log.push(`${cmd} ${args.slice(0, 4).join(" ")}`);
      if (cmd === "git") return { code: 0, output: "" };
      const n = i++;
      return { code: codes[n] ?? 0, output: outputs[n] ?? "" };
    };
    return { run, log };
  };

  it("passes only when test fails on base, passes with patch, and typechecks", async () => {
    const d = dir();
    const { run } = script([1, 0, 0], ["AssertionError", "ok", "ok"]);
    const r = await verifyPatch(d, [src, test], incident, run);
    assert.equal(r.ok, true);
    assert.equal(readFileSync(join(d, src.path), "utf8"), "fixed");
    if (r.ok) assert.deepEqual([r.evidence.beforeExit, r.evidence.afterExit, r.evidence.typecheckExit], [1, 0, 0]);
  });
  it("rejects a test that already passes on base", async () => {
    const r = await verifyPatch(dir(), [src, test], incident, script([0]).run);
    assert.equal(r.ok === false && r.reason, "test_passes_on_base");
  });
  it("rejects a test that failed only because it never ran", async () => {
    const r = await verifyPatch(dir(), [src, test], incident, script([1], ["No test files found"]).run);
    assert.equal(r.ok === false && r.reason, "test_did_not_run_on_base");
  });
  it("rejects when the test still fails with the patch", async () => {
    const r = await verifyPatch(dir(), [src, test], incident, script([1, 1]).run);
    assert.equal(r.ok === false && r.reason, "test_fails_with_patch");
  });
  it("rejects when typecheck fails", async () => {
    const r = await verifyPatch(dir(), [src, test], incident, script([1, 0, 2]).run);
    assert.equal(r.ok === false && r.reason, "typecheck_failed");
  });
  it("never runs a command for structurally invalid patches", async () => {
    const { run, log } = script([]);
    const r = await verifyPatch(dir(), [src], incident, run);
    assert.equal(r.ok === false && r.reason, "no_regression_test");
    assert.deepEqual(log, []);
  });
});
