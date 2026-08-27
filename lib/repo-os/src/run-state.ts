/**
 * Explicit autonomous-run state machine.
 *
 * Every state change is a recorded, auditable event. Illegal transitions are
 * rejected rather than tolerated, so a run can never appear to be "deploying"
 * without having passed review, and a failed run can never quietly resume.
 */

export const RUN_STATES = [
  "DISCOVERED",
  "INDEXING",
  "ANALYZING",
  "RECOMMENDATIONS_READY",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PLANNING",
  "IMPLEMENTING",
  "BUILDING",
  "TESTING",
  "REPAIRING",
  "REVIEWING",
  "PR_READY",
  "AWAITING_MERGE",
  "DEPLOYING",
  "VERIFYING",
  "COMPLETE",
  "BLOCKED",
  "FAILED",
  "ROLLED_BACK",
] as const;

export type RunState = (typeof RUN_STATES)[number];

/** States a run can never leave. */
export const TERMINAL_STATES: readonly RunState[] = ["COMPLETE", "FAILED", "ROLLED_BACK"];

/** From every state, `BLOCKED` and `FAILED` are always reachable. */
const UNIVERSAL_EXITS: RunState[] = ["BLOCKED", "FAILED"];

const TRANSITIONS: Record<RunState, RunState[]> = {
  DISCOVERED: ["INDEXING"],
  INDEXING: ["ANALYZING"],
  ANALYZING: ["RECOMMENDATIONS_READY"],
  RECOMMENDATIONS_READY: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "RECOMMENDATIONS_READY"],
  APPROVED: ["PLANNING"],
  PLANNING: ["IMPLEMENTING", "AWAITING_APPROVAL"],
  IMPLEMENTING: ["BUILDING"],
  BUILDING: ["TESTING", "REPAIRING"],
  TESTING: ["REVIEWING", "REPAIRING"],
  REPAIRING: ["BUILDING", "IMPLEMENTING"],
  REVIEWING: ["PR_READY", "REPAIRING"],
  PR_READY: ["AWAITING_MERGE"],
  AWAITING_MERGE: ["DEPLOYING", "COMPLETE"],
  DEPLOYING: ["VERIFYING", "ROLLED_BACK"],
  VERIFYING: ["COMPLETE", "REPAIRING", "ROLLED_BACK"],
  COMPLETE: [],
  BLOCKED: ["PLANNING", "IMPLEMENTING", "AWAITING_APPROVAL"],
  FAILED: [],
  ROLLED_BACK: [],
};

export interface AuditEvent {
  runId: string;
  from: RunState;
  to: RunState;
  at: string;
  actor: string;
  reason: string;
  /** Structured detail — evidence, test output references, failure classification. */
  detail?: Record<string, unknown>;
}

export function allowedTransitions(from: RunState): RunState[] {
  const base = TRANSITIONS[from] ?? [];
  if (TERMINAL_STATES.includes(from)) return [...base];
  return [...new Set([...base, ...UNIVERSAL_EXITS])];
}

export function canTransition(from: RunState, to: RunState): boolean {
  return allowedTransitions(from).includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`Illegal run transition ${from} → ${to}. Allowed: ${allowedTransitions(from).join(", ") || "(terminal state)"}`);
    this.name = "IllegalTransitionError";
  }
}

/** Perform a transition, returning the audit event that records it. */
export function transition(params: {
  runId: string;
  from: RunState;
  to: RunState;
  actor: string;
  reason: string;
  detail?: Record<string, unknown>;
  now?: Date;
}): AuditEvent {
  if (!canTransition(params.from, params.to)) {
    throw new IllegalTransitionError(params.from, params.to);
  }
  const event: AuditEvent = {
    runId: params.runId,
    from: params.from,
    to: params.to,
    at: (params.now ?? new Date()).toISOString(),
    actor: params.actor,
    reason: params.reason,
  };
  if (params.detail) event.detail = params.detail;
  return event;
}

/** Replay an audit trail to derive the current state, validating as it goes. */
export function replay(events: AuditEvent[], initial: RunState = "DISCOVERED"): RunState {
  let state = initial;
  for (const event of events) {
    if (event.from !== state) {
      throw new Error(`Audit trail is inconsistent: event claims from=${event.from} but run is in ${state}`);
    }
    if (!canTransition(event.from, event.to)) throw new IllegalTransitionError(event.from, event.to);
    state = event.to;
  }
  return state;
}
