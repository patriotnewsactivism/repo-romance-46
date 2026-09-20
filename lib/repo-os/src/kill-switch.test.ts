import { describe, expect, it } from "vitest";
import {
  assertAutonomousOperationsPermitted,
  evaluateKillSwitch,
  isKillSwitchActive,
} from "./kill-switch";

describe("kill switch evaluation", () => {
  it("keeps autonomous operations permitted when the feature is disabled", () => {
    expect(isKillSwitchActive("false", null)).toBe(false);
    expect(assertAutonomousOperationsPermitted({ envValue: "false", dbEngaged: null })).toEqual({
      active: false,
      status: "inactive",
      reason: "kill switch feature is explicitly disabled",
    });
  });

  it("permits operations when the feature is enabled and the database is disengaged", () => {
    expect(isKillSwitchActive("true", false)).toBe(false);
    expect(evaluateKillSwitch({ envValue: "true", dbEngaged: false }).status).toBe("inactive");
  });

  it("blocks operations when the database is explicitly engaged", () => {
    expect(isKillSwitchActive("false", true)).toBe(true);
    expect(() => assertAutonomousOperationsPermitted({ featureEnabled: false, dbEngaged: true })).toThrow(
      /database status is explicitly engaged/,
    );
  });

  it("fails closed for an unreadable database status while enabled", () => {
    const result = evaluateKillSwitch({ envValue: "true", dbEngaged: null });
    expect(result).toEqual({
      active: true,
      status: "unknown",
      reason: "kill switch status is unreadable; failing closed",
    });
    expect(() => assertAutonomousOperationsPermitted({ envValue: "true", dbEngaged: null })).toThrow(
      /failing closed/,
    );
  });

  it("fails closed for an unknown feature state", () => {
    expect(isKillSwitchActive("unknown", null)).toBe(true);
    expect(() => assertAutonomousOperationsPermitted({ featureEnabled: true, dbEngaged: undefined })).toThrow(
      /blocked/,
    );
  });

  it("treats an explicitly disengaged database as safe when the feature is enabled", () => {
    expect(assertAutonomousOperationsPermitted({ envValue: "true", dbEngaged: false }).active).toBe(false);
  });
});
