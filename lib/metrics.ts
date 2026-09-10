/**
 * Granular cost tracking and business metrics (FinOps).
 */

export interface AiUsageMetric {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  sessionId?: string;
  taskType?: string;
}

export interface CompletionMetric {
  sessionId: string;
  repoFullName: string;
  iterations: number;
  success: boolean;
  durationMs: number;
  completionDelta: number;
  readinessDelta: number;
}

const buffer: (AiUsageMetric | CompletionMetric)[] = [];

export function recordAiUsage(metric: AiUsageMetric): void {
  buffer.push(metric);
  // In production, flush to Cloud Monitoring / OpenTelemetry / BigQuery
  console.debug('[metrics] AI usage', metric);
}

export function recordCompletion(metric: CompletionMetric): void {
  buffer.push(metric);
  console.debug('[metrics] Completion', metric);
}

export function getBufferedMetrics() {
  return [...buffer];
}

export function clearBuffer() {
  buffer.length = 0;
}
