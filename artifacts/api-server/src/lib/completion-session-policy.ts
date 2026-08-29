export interface CompletionSessionProgressInput {
  completionPct: number | null;
  readinessPct: number | null;
  previousCompletionPct: number | null;
  previousReadinessPct: number | null;
  targetCompletionPct: number;
  targetReadinessPct: number;
  iterationCount: number;
  maxIterations: number;
  noProgressCount: number;
  maxNoProgressIterations: number;
}

export interface CompletionSessionProgressDecision {
  action: "complete" | "continue" | "block";
  noProgressCount: number;
  reason: string;
  progress: {
    completionDelta: number | null;
    readinessDelta: number | null;
  };
}

function finite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function evaluateCompletionSessionProgress(
  input: CompletionSessionProgressInput,
): CompletionSessionProgressDecision {
  const completion = finite(input.completionPct);
  const readiness = finite(input.readinessPct);
  const previousCompletion = finite(input.previousCompletionPct);
  const previousReadiness = finite(input.previousReadinessPct);
  const completionDelta = completion !== null && previousCompletion !== null
    ? Math.round((completion - previousCompletion) * 10) / 10
    : null;
  const readinessDelta = readiness !== null && previousReadiness !== null
    ? Math.round((readiness - previousReadiness) * 10) / 10
    : null;

  if (completion !== null && readiness !== null &&
      completion >= input.targetCompletionPct && readiness >= input.targetReadinessPct) {
    return {
      action: "complete",
      noProgressCount: 0,
      reason: `Targets reached: completion ${completion}%/${input.targetCompletionPct}% and readiness ${readiness}%/${input.targetReadinessPct}%.`,
      progress: { completionDelta, readinessDelta },
    };
  }

  if (input.iterationCount >= input.maxIterations) {
    return {
      action: "block",
      noProgressCount: input.noProgressCount,
      reason: `Maximum of ${input.maxIterations} bounded iterations reached before both targets were met.`,
      progress: { completionDelta, readinessDelta },
    };
  }

  // Treat tiny score movement as noise. A session gets a bounded number of
  // consecutive low-progress iterations before it stops rather than churning.
  const hasPriorMeasurement = previousCompletion !== null || previousReadiness !== null;
  const meaningfulCompletion = completionDelta !== null && completionDelta >= 1;
  const meaningfulReadiness = readinessDelta !== null && readinessDelta >= 1;
  const regressed = (completionDelta !== null && completionDelta < -1) ||
    (readinessDelta !== null && readinessDelta < -1);
  const noMeaningfulProgress = hasPriorMeasurement && !meaningfulCompletion && !meaningfulReadiness;
  const nextNoProgressCount = noMeaningfulProgress ? input.noProgressCount + 1 : 0;

  if (regressed && nextNoProgressCount >= input.maxNoProgressIterations) {
    return {
      action: "block",
      noProgressCount: nextNoProgressCount,
      reason: `Measured completion/readiness regressed and the session reached its ${input.maxNoProgressIterations}-iteration no-progress limit.`,
      progress: { completionDelta, readinessDelta },
    };
  }

  if (nextNoProgressCount >= input.maxNoProgressIterations) {
    return {
      action: "block",
      noProgressCount: nextNoProgressCount,
      reason: `No meaningful completion or readiness gain was measured for ${nextNoProgressCount} consecutive iterations; stopping instead of churning.`,
      progress: { completionDelta, readinessDelta },
    };
  }

  return {
    action: "continue",
    noProgressCount: nextNoProgressCount,
    reason: completion === null || readiness === null
      ? "Targets cannot yet be proven from measured completion/readiness evidence; another bounded evidence-driven iteration is allowed."
      : `Targets not yet reached: completion ${completion}%/${input.targetCompletionPct}%, readiness ${readiness}%/${input.targetReadinessPct}%.`,
    progress: { completionDelta, readinessDelta },
  };
}
