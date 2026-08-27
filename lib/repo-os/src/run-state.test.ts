import { describe, expect, it } from "vitest";
import { IllegalTransitionError, allowedTransitions, canTransition, replay, transition, type AuditEvent } from "./run-state";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("canTransition", () => {
  it("allows the happy path through to completion", () => {
    const path = [
      "DISCOVERED", "INDEXING", "ANALYZING", "RECOMMENDATIONS_READY", "AWAITING_APPROVAL",
      "APPROVED", "PLANNING", "IMPLEMENTING", "BUILDING", "TESTING", "REVIEWING",
      "PR_READY", "AWAITING_MERGE", "DEPLOYING", "VERIFYING", "COMPLETE",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("refuses to skip approval", () => {
    expect(canTransition("RECOMMENDATIONS_READY", "IMPLEMENTING")).toBe(false);
    expect(canTransition("AWAITING_APPROVAL", "IMPLEMENTING")).toBe(false);
  });

  it("refuses to deploy without review", () => {
    expect(canTransition("TESTING", "DEPLOYING")).toBe(false);
    expect(canTransition("IMPLEMENTING", "DEPLOYING")).toBe(false);
  });

  it("allows failure and blocking from any live state", () => {
    expect(canTransition("BUILDING", "FAILED")).toBe(true);
    expect(canTransition("VERIFYING", "BLOCKED")).toBe(true);
  });

  it("treats COMPLETE, FAILED and ROLLED_BACK as terminal", () => {
    for (const terminal of ["COMPLETE", "FAILED", "ROLLED_BACK"] as const) {
      expect(allowedTransitions(terminal)).toEqual([]);
      expect(canTransition(terminal, "PLANNING")).toBe(false);
    }
  });

  it("lets a repair loop run between build, test and implement", () => {
    expect(canTransition("TESTING", "REPAIRING")).toBe(true);
    expect(canTransition("REPAIRING", "BUILDING")).toBe(true);
    expect(canTransition("BUILDING", "TESTING")).toBe(true);
  });

  it("lets a blocked run resume once the blocker clears", () => {
    expect(canTransition("BLOCKED", "PLANNING")).toBe(true);
  });
});

describe("transition", () => {
  it("returns an audit event describing the change", () => {
    const event = transition({
      runId: "run_1",
      from: "BUILDING",
      to: "TESTING",
      actor: "qa-agent",
      reason: "build succeeded",
      detail: { durationMs: 4200 },
      now: NOW,
    });
    expect(event).toEqual({
      runId: "run_1",
      from: "BUILDING",
      to: "TESTING",
      at: NOW.toISOString(),
      actor: "qa-agent",
      reason: "build succeeded",
      detail: { durationMs: 4200 },
    });
  });

  it("throws on an illegal transition and names what was allowed", () => {
    expect(() => transition({ runId: "r", from: "ANALYZING", to: "DEPLOYING", actor: "a", reason: "r" })).toThrow(
      IllegalTransitionError,
    );
    try {
      transition({ runId: "r", from: "ANALYZING", to: "DEPLOYING", actor: "a", reason: "r" });
    } catch (err) {
      expect((err as Error).message).toMatch(/Allowed: RECOMMENDATIONS_READY/);
    }
  });
});

describe("replay", () => {
  const event = (from: AuditEvent["from"], to: AuditEvent["to"]): AuditEvent => ({
    runId: "run_1",
    from,
    to,
    at: NOW.toISOString(),
    actor: "orchestrator",
    reason: "step",
  });

  it("derives the current state from the audit trail", () => {
    expect(replay([event("DISCOVERED", "INDEXING"), event("INDEXING", "ANALYZING")])).toBe("ANALYZING");
  });

  it("rejects a trail with a gap in it", () => {
    expect(() => replay([event("DISCOVERED", "INDEXING"), event("ANALYZING", "RECOMMENDATIONS_READY")])).toThrow(
      /inconsistent/,
    );
  });

  it("rejects a trail containing an illegal transition", () => {
    expect(() => replay([event("DISCOVERED", "DEPLOYING")])).toThrow(IllegalTransitionError);
  });
});
