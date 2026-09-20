export type KillSwitchStatus = "active" | "inactive" | "unknown";

export interface KillSwitchOptions {
  envValue?: string;
  dbEngaged?: boolean | null | undefined;
  featureEnabled?: boolean;
}

export interface KillSwitchResult {
  active: boolean;
  status: KillSwitchStatus;
  reason: string;
}

type FeatureState = boolean | "unknown";

function parseFeatureState(value: string | undefined): FeatureState {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return "unknown";
}

export function evaluateKillSwitch(options: KillSwitchOptions = {}): KillSwitchResult {
  const dbEngaged = options.dbEngaged;
  if (dbEngaged === true) {
    return { active: true, status: "active", reason: "database status is explicitly engaged" };
  }

  const featureState =
    options.featureEnabled !== undefined ? options.featureEnabled : parseFeatureState(options.envValue);
  if (featureState === false) {
    return { active: false, status: "inactive", reason: "kill switch feature is explicitly disabled" };
  }

  if (dbEngaged === false) {
    return { active: false, status: "inactive", reason: "database status is explicitly disengaged" };
  }

  return { active: true, status: "unknown", reason: "kill switch status is unreadable; failing closed" };
}

export function isKillSwitchActive(
  envValue?: string,
  dbEngaged?: boolean | null | undefined,
): boolean {
  return evaluateKillSwitch({ envValue, dbEngaged }).active;
}

export function assertAutonomousOperationsPermitted(options: KillSwitchOptions = {}): KillSwitchResult {
  const result = evaluateKillSwitch(options);
  if (result.active) {
    throw new Error(`Autonomous operations are blocked: ${result.reason}`);
  }
  return result;
}
