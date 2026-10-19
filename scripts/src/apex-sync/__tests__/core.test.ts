import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_GATE, emptyLedger, gate, loadLedger, recordDebate, recordOutcome } from "../ledger.js";
import { ObserveError, observeApex } from "../observe.js";
import { signatureOf } from "../signature.js";

describe("signature", () => {
  it("is stable across ids, timestamps and counters", () => {
    const a = signatureOf({ component: "db", errorSignature: "timeout after 3021ms at 2026-10-19T10:00:00Z req 9f86d081884c7d65" });
    const b = signatureOf({ component: "DB", errorSignature: "timeout after 77ms at 2026-10-20T01:02:03Z req aaaaaaaaaaaaaaaa" });
    assert.equal(a, b);
  });
  it("differs by component", () => {
    assert.notEqual(signatureOf({ component: "db", errorSignature: "x" }), signatureOf({ component: "api", errorSignature: "x" }));
  });
});

describe("ledger gate", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  it("allows a fresh signature", () => assert.deepEqual(gate(emptyLedger(), "s", now, 0), { allow: true }));
  it("refuses when an auto-fix PR is already open", () => {
    assert.deepEqual(gate(emptyLedger(), "s", now, 1), { allow: false, reason: "open_pr_cap" });
  });
  it("refuses a signature that already has a PR", () => {
    const l = recordOutcome(emptyLedger(), { signature: "s", status: "pr_opened", at: "2026-10-18T12:00:00Z" });
    assert.deepEqual(gate(l, "s", now, 0), { allow: false, reason: "already_has_pr" });
  });
  it("applies the blocked cooldown, then releases", () => {
    const l = recordOutcome(emptyLedger(), { signature: "s", status: "blocked", at: "2026-10-19T06:00:00Z" });
    assert.deepEqual(gate(l, "s", now, 0), { allow: false, reason: "blocked_cooldown" });
    assert.deepEqual(gate(l, "s", new Date("2026-10-20T07:00:00Z"), 0), { allow: true });
  });
  it("enforces the daily debate cap and resets next day", () => {
    let l = emptyLedger();
    for (let i = 0; i < DEFAULT_GATE.dailyDebateCap; i++) l = recordDebate(l, now);
    assert.deepEqual(gate(l, "s", now, 0), { allow: false, reason: "daily_debate_cap" });
    assert.deepEqual(gate(l, "s", new Date("2026-10-20T00:01:00Z"), 0), { allow: true });
  });
  it("fails closed on a corrupt ledger file", () => {
    const p = join(mkdtempSync(join(tmpdir(), "led-")), "l.json");
    writeFileSync(p, "{not json");
    assert.throws(() => loadLedger(p), /unreadable/);
  });
});

describe("observeApex", () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("returns only unhealthy components, worst first, with mapped files", async () => {
    let auth = "";
    const f = (async (_u: unknown, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify([
        { component: "db", status: "healthy", consecutiveFailures: 0 },
        { component: "queue", status: "degraded", detail: "lag", consecutiveFailures: 1 },
        { component: "api", status: "unhealthy", detail: "500s", consecutiveFailures: 6 },
      ]));
    }) as unknown as typeof fetch;
    const out = await observeApex({ baseUrl: "https://apex.test/", token: "tok", componentFiles: { api: ["a.ts"] }, fetchImpl: f });
    assert.equal(auth, "Bearer tok");
    assert.deepEqual(out.map((i) => [i.component, i.severity, i.files]), [["api", "P1", ["a.ts"]], ["queue", "P3", []]]);
  });
  it("throws (fail closed) on HTTP errors and bad shapes", async () => {
    await assert.rejects(observeApex({ baseUrl: "https://a", token: "t", fetchImpl: ok({}, 401) }), ObserveError);
    await assert.rejects(observeApex({ baseUrl: "https://a", token: "t", fetchImpl: ok({ not: "array" }) }), ObserveError);
    const boom = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    await assert.rejects(observeApex({ baseUrl: "https://a", token: "t", fetchImpl: boom }), /unreachable/);
  });
});
