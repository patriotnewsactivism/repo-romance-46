import type { SupabaseClient } from "@supabase/supabase-js";

const OUTCOME_COLUMNS = new Set([
  "analysis_id",
  "item_rank",
  "prompt_version",
  "baseline_metrics",
  "outcome_metrics",
  "outcome_score",
  "evaluated_at",
]);

export function isOutcomeTelemetrySchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  return /analysis_id|item_rank|prompt_version|baseline_metrics|outcome_metrics|outcome_score|evaluated_at/i.test(message) &&
    /column|schema|cache|does not exist|could not find/i.test(message);
}

function withoutOutcomeColumns(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !OUTCOME_COLUMNS.has(key)));
}

/**
 * Writes a completion run with outcome telemetry when the additive migration is
 * available. During rolling deploys, older databases fall back to the durable
 * run schema rather than breaking approvals/execution.
 */
export async function insertCompletionRunCompat(
  supabase: SupabaseClient,
  values: Record<string, unknown>,
  select = "*",
): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null; telemetryPersisted: boolean }> {
  const first = await supabase.from("completion_runs").insert(values).select(select).single();
  if (!first.error) {
    return {
      data: first.data as unknown as Record<string, unknown>,
      error: null,
      telemetryPersisted: true,
    };
  }

  if (!isOutcomeTelemetrySchemaMissing(first.error)) {
    return { data: null, error: first.error, telemetryPersisted: false };
  }

  const fallback = await supabase
    .from("completion_runs")
    .insert(withoutOutcomeColumns(values))
    .select(select)
    .single();
  return {
    data: fallback.data ? (fallback.data as unknown as Record<string, unknown>) : null,
    error: fallback.error,
    telemetryPersisted: false,
  };
}
