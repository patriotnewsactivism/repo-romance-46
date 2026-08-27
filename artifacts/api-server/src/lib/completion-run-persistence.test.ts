import { describe, expect, it } from "vitest";
import { isOutcomeTelemetrySchemaMissing } from "./completion-run-persistence";

describe("isOutcomeTelemetrySchemaMissing", () => {
  it("recognizes Postgres and PostgREST missing-column failures", () => {
    expect(isOutcomeTelemetrySchemaMissing({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(isOutcomeTelemetrySchemaMissing({ code: "PGRST204", message: "Could not find prompt_version in the schema cache" })).toBe(true);
  });

  it("recognizes schema-cache messages for outcome telemetry columns", () => {
    expect(
      isOutcomeTelemetrySchemaMissing({
        message: "Could not find the 'baseline_metrics' column of 'completion_runs' in the schema cache",
      }),
    ).toBe(true);
  });

  it("does not hide unrelated database errors", () => {
    expect(isOutcomeTelemetrySchemaMissing({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isOutcomeTelemetrySchemaMissing(null)).toBe(false);
  });
});
