/**
 * Rule-based Risk Assessment Framework for Tiered Autonomy.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

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
  score: number; // 0-100
  reasons: string[];
  recommendedAutonomy: 'auto-merge' | 'one-click-approve' | 'full-review' | 'human-required';
}

export function assessRisk(factors: RiskFactors): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (factors.codeChurnLines > 500) {
    score += 25;
    reasons.push(`High churn: ${factors.codeChurnLines} lines`);
  } else if (factors.codeChurnLines > 100) {
    score += 10;
  }

  if (factors.filesTouched > 20) {
    score += 15;
    reasons.push(`Many files: ${factors.filesTouched}`);
  }

  if (factors.touchesSecuritySensitive) {
    score += 30;
    reasons.push('Touches security-sensitive paths');
  }
  if (factors.touchesAuth) {
    score += 25;
    reasons.push('Touches authentication');
  }
  if (factors.touchesPayments) {
    score += 30;
    reasons.push('Touches payments');
  }
  if (factors.touchesMigrations) {
    score += 20;
    reasons.push('Includes schema migrations');
  }

  if (factors.aiConfidence < 0.5) {
    score += 20;
    reasons.push(`Low AI confidence: ${factors.aiConfidence}`);
  }

  if (factors.diffSizeKb > 50) {
    score += 15;
    reasons.push(`Large diff: ${factors.diffSizeKb} KB`);
  }

  let level: RiskLevel = 'low';
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'high';
  else if (score >= 20) level = 'medium';

  let recommendedAutonomy: RiskAssessment['recommendedAutonomy'] = 'auto-merge';
  if (level === 'critical') recommendedAutonomy = 'human-required';
  else if (level === 'high') recommendedAutonomy = 'full-review';
  else if (level === 'medium') recommendedAutonomy = 'one-click-approve';

  return { level, score, reasons, recommendedAutonomy };
}
