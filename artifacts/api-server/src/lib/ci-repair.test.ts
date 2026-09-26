import { describe, expect, it } from "vitest";
import { acceptRepairDiagnosis } from "./ci-repair";

const valid = {
  rootCause: "Type error in the new route",
  confidence: 80,
  evidence: ["tsc failed on settings.tsx"],
  rejectedCauses: ["flaky network"],
  repairStrategy: ["Add the missing return type"],
  regressionRisks: ["Could hide a real type error"],
  stopIf: ["The same diagnostic repeats"],
};

describe("acceptRepairDiagnosis", () => {
  it("accepts a complete diagnosis inside the confidence range", () => {
    expect(acceptRepairDiagnosis(valid)).toEqual(valid);
    expect(acceptRepairDiagnosis({ ...valid, confidence: 0 })).toMatchObject({ confidence: 0 });
    expect(acceptRepairDiagnosis({ ...valid, confidence: 100 })).toMatchObject({ confidence: 100 });
  });

  it("rejects confidence outside 0-100 and incomplete arrays so repair is not skipped", () => {
    expect(acceptRepairDiagnosis({ ...valid, confidence: 101 })).toBeNull();
    expect(acceptRepairDiagnosis({ ...valid, confidence: Number.NaN })).toBeNull();
    expect(acceptRepairDiagnosis({ ...valid, repairStrategy: [] })).toBeNull();
    expect(acceptRepairDiagnosis({ ...valid, evidence: undefined })).toBeNull();
    expect(acceptRepairDiagnosis({ ...valid, stopIf: "halt" })).toBeNull();
    expect(acceptRepairDiagnosis(null)).toBeNull();
    expect(acceptRepairDiagnosis([])).toBeNull();
  });
});
