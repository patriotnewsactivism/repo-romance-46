export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RecommendedAutonomy = "auto-merge" | "one-click-approve" | "full-review" | "human-required";

export interface RiskFactors {
  codeChurnLines: number;
  filesTouched: number;
  touchesSecuritySensitive: boolean;
  touchesAuth: boolean;
  touchesPayments: boolean;
  touchesMigrations: boolean;
  aiConfidence: number;
  hasCodeowners: boolean;
  diffSizeKb: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  reasons: string[];
  recommendedAutonomy: RecommendedAutonomy;
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}: expected a finite non-negative number`);
  }
}

function assertConfidence(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid aiConfidence: expected a finite number between 0 and 1`);
  }
}

export function assessRisk(factors: RiskFactors): RiskAssessment {
  assertFiniteNonNegative("codeChurnLines", factors.codeChurnLines);
  assertFiniteNonNegative("filesTouched", factors.filesTouched);
  assertFiniteNonNegative("diffSizeKb", factors.diffSizeKb);
  assertConfidence(factors.aiConfidence);

  let score = 0;
  const reasons: string[] = [];
  const addRisk = (points: number, reason: string): void => {
    score += points;
    reasons.push(reason);
  };

  if (factors.codeChurnLines > 500) {
    addRisk(20, `High code churn: ${factors.codeChurnLines} lines changed`);
  } else if (factors.codeChurnLines > 100) {
    addRisk(10, `Moderate code churn: ${factors.codeChurnLines} lines changed`);
  }

  if (factors.filesTouched > 20) {
    addRisk(20, `Wide change scope: ${factors.filesTouched} files touched`);
  } else if (factors.filesTouched > 5) {
    addRisk(10, `Change scope spans ${factors.filesTouched} files`);
  }

  if (factors.touchesSecuritySensitive) addRisk(30, "Touches security-sensitive code or configuration");
  if (factors.touchesAuth) addRisk(30, "Touches authentication or authorization behavior");
  if (factors.touchesPayments) addRisk(35, "Touches payment or monetary transaction behavior");
  if (factors.touchesMigrations) addRisk(25, "Touches a database migration or schema change");

  if (factors.aiConfidence < 0.5) {
    addRisk(20, `Low AI confidence: ${factors.aiConfidence}`);
  } else if (factors.aiConfidence < 0.7) {
    addRisk(10, `Moderate AI confidence: ${factors.aiConfidence}`);
  } else if (factors.aiConfidence < 0.9) {
    addRisk(5, `AI confidence is not high: ${factors.aiConfidence}`);
  }

  if (factors.diffSizeKb > 100) {
    addRisk(15, `Large diff: ${factors.diffSizeKb} KB`);
  } else if (factors.diffSizeKb > 20) {
    addRisk(10, `Diff size is ${factors.diffSizeKb} KB`);
  }

  if (factors.hasCodeowners && score > 0) {
    score -= 10;
    reasons.push("CODEOWNERS coverage provides an additional review path");
  }

  const hasCriticalDomainRisk =
    factors.touchesSecuritySensitive ||
    factors.touchesAuth ||
    factors.touchesPayments ||
    factors.touchesMigrations;
  if (hasCriticalDomainRisk) {
    const beforeCriticalFloor = score;
    score = Math.max(score, 80);
    if (score > beforeCriticalFloor) {
      reasons.push("Critical security, auth, payment, or migration risk sets a minimum score of 80");
    }
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let level: RiskLevel = "low";
  if (score >= 80) level = "critical";
  else if (score >= 50) level = "high";
  else if (score >= 20) level = "medium";

  let recommendedAutonomy: RecommendedAutonomy = "auto-merge";
  if (level === "critical") recommendedAutonomy = "human-required";
  else if (level === "high") recommendedAutonomy = "full-review";
  else if (level === "medium") recommendedAutonomy = "one-click-approve";

  if (reasons.length === 0) reasons.push("No elevated risk signals detected");
  return { level, score, reasons, recommendedAutonomy };
}

export const assessChangeRisk = assessRisk;
