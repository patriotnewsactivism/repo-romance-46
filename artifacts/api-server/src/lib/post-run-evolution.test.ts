import { describe, expect, it } from "vitest";
import { acceptanceVerifiedAt } from "./post-run-evolution";

const NOW = "2026-09-23T00:00:00.000Z";

describe("acceptanceVerifiedAt", () => {
  it("does not treat a failed or pending check as verification", () => {
    expect(
      acceptanceVerifiedAt(
        [
          { name: "build", status: "completed", conclusion: "failure" },
          { name: "test", status: "in_progress", conclusion: null },
        ],
        false,
        NOW,
      ),
    ).toBeUndefined();
  });

  it("stamps verifiedAt when an accepted check succeeds", () => {
    expect(
      acceptanceVerifiedAt([{ name: "ci", status: "completed", conclusion: "success" }], undefined, NOW),
    ).toBe(NOW);
  });

  it("stamps verifiedAt when the inspected deployment succeeded", () => {
    expect(acceptanceVerifiedAt([], true, NOW)).toBe(NOW);
  });
});
