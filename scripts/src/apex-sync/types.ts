export type Severity = "P0" | "P1" | "P2" | "P3";

/** VERIFIED = local gate passed; BLOCKED = proof missing/failed; NO_SIGNAL = nothing to do; SKIPPED = gated before any LLM spend. */
export type Verdict = "VERIFIED" | "BLOCKED" | "NO_SIGNAL" | "SKIPPED";

export interface Incident {
  severity: Severity;
  /** Apex component key or repo-relative path the failure is attributed to. */
  component: string;
  errorSignature: string;
  detail?: string;
  /** Repo-relative Apex files the patch is allowed to touch (and that are sent to Think Tank). */
  files: string[];
  /** Optional hint for the regression test path; the candidate must still supply a failing-then-passing test. */
  testPath?: string;
}

export interface HandoffPayload {
  trace_id: string;
  source: "repo-romance-46";
  target_system: "apex-runtime";
  incident: { severity: Severity; component: string; error_signature: string };
  proposed_patch: { summary: string; diff_preview: string; verification_test: string };
  debate_constraints: {
    require_test_evidence: true;
    max_iterations: number;
    fail_closed_if_unverified: true;
  };
}

export interface FileChange {
  path: string;
  content: string;
}

export interface LedgerEntry {
  signature: string;
  status: "pr_opened" | "blocked";
  at: string;
  prUrl?: string;
  reason?: string;
}

export interface Ledger {
  entries: LedgerEntry[];
  debateDay: string;
  debateCount: number;
}

export interface Outcome {
  verdict: Verdict;
  reason: string;
  traceId?: string;
  signature?: string;
  prUrl?: string;
  evidence?: Record<string, unknown>;
}
