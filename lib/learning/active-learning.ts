/**
 * Active Learning (RLHF-style) framework for refining confidence and strategies.
 * Operational learning only – does not retrain model weights.
 */

export interface HumanOverride {
  sessionId: string;
  originalConfidence: number;
  humanDecision: 'approved' | 'rejected' | 'modified';
  reason?: string;
  outcomeScore?: number;
}

const overrides: HumanOverride[] = [];

export function recordHumanOverride(override: HumanOverride): void {
  overrides.push(override);
  console.info('[active-learning] recorded override', override);
}

export function getAdjustedConfidence(baseConfidence: number, taskType: string): number {
  // Simple heuristic: if many recent rejections for this task type, lower confidence
  const recent = overrides.filter((o) => o.humanDecision === 'rejected').slice(-20);
  if (recent.length > 5) {
    return Math.max(0.1, baseConfidence * 0.8);
  }
  return baseConfidence;
}

export function suggestStrategyAdjustment(): string | null {
  const rejectionRate = overrides.filter((o) => o.humanDecision === 'rejected').length / Math.max(1, overrides.length);
  if (rejectionRate > 0.4) {
    return 'Consider increasing evidence requirements or lowering autonomy for similar tasks';
  }
  return null;
}
