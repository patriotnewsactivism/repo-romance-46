import type { SupabaseClient } from "@supabase/supabase-js";
import { reasonAboutRepositoryPlan, type ReasonedPlanningResult } from "./reasoning-orchestrator";

export type ExternalPromptProvider = "provider-neutral" | "codex" | "claude-code" | "gemini-cli";
export const EXTERNAL_PROMPT_VERSION = "external-completion-handoff-v1";

interface PortfolioSnapshot {
  completionPct: number | null;
  productionReadinessPct: number | null;
  commercializationProbability: number | null;
  finishFirstScore: number | null;
  remainingHours: number | null;
  presentValueUsd: { low: number; high: number } | null;
  potentialValueUsd: { low: number; high: number } | null;
  evidenceConfidence: number | null;
}

export interface ExternalCompletionPromptResult {
  prompt: string;
  provider: ExternalPromptProvider;
  promptVersion: string;
  assessment: {
    repo: string;
    headSha: string;
    defaultBranch: string;
    reasoningTraceId: string | null;
    reasoningConfidence: number;
    specialists: string[];
    treeSignals: ReasonedPlanningResult["evidence"]["treeSignals"];
    portfolio: PortfolioSnapshot | null;
    summary: string;
    nextSteps: string[];
    risks: string[];
    validation: string[];
    stopConditions: string[];
  };
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): { low: number; high: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const low = finite(record.low);
  const high = finite(record.high);
  return low === null || high === null ? null : { low, high };
}

async function loadPortfolioSnapshot(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string | undefined,
  repo: string,
): Promise<PortfolioSnapshot | null> {
  if (!analysisId) return null;
  const { data, error } = await supabase
    .from("analyses")
    .select("investment_intelligence")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const intelligence = (data as Record<string, unknown>).investment_intelligence;
  if (!intelligence || typeof intelligence !== "object") return null;
  const ranking = (intelligence as Record<string, unknown>).ranking;
  if (!Array.isArray(ranking)) return null;
  const row = ranking.find((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).repo || "") === repo) as Record<string, unknown> | undefined;
  if (!row) return null;
  const remaining = row.remainingWork && typeof row.remainingWork === "object" ? row.remainingWork as Record<string, unknown> : {};
  return {
    completionPct: finite(row.completionPct),
    productionReadinessPct: finite(row.productionReadinessPct),
    commercializationProbability: finite(row.commercializationProbability),
    finishFirstScore: finite(row.finishFirstScore),
    remainingHours: finite(remaining.hours),
    presentValueUsd: money(row.presentValueUsd),
    potentialValueUsd: money(row.potentialValueUsd),
    evidenceConfidence: finite(row.evidenceConfidence),
  };
}

function providerInstructions(provider: ExternalPromptProvider) {
  switch (provider) {
    case "codex":
      return "Use Codex repository tools aggressively: inspect files before editing, run commands/tests in the workspace, make small coherent commits where appropriate, and use the repository's existing CI/deployment tooling as the source of truth.";
    case "claude-code":
      return "Use Claude Code's repository search/edit/terminal capabilities to validate this assessment against the actual checkout before changing anything. Work in small verified batches and keep a running todo/checklist tied to acceptance evidence.";
    case "gemini-cli":
      return "Use Gemini CLI's codebase inspection and shell capabilities to validate the repository state first. Keep tool output grounded in current files and tests, and verify every completion claim with executable evidence.";
    default:
      return "Use whatever repository, terminal, CI, deployment, database, and browser tools are available. Inspect before editing and treat actual repository/runtime evidence as authoritative over this handoff if anything has changed.";
  }
}

function pct(value: number | null) {
  return value === null ? "not measured" : `${Math.round(value * 10) / 10}%`;
}

function moneyRange(value: { low: number; high: number } | null) {
  if (!value) return "not measured";
  const format = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return `${format(value.low)}–${format(value.high)}`;
}

function bulletList(values: string[], empty = "- None identified from current evidence.") {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : empty;
}

export async function buildExternalCompletionPrompt(
  supabase: SupabaseClient,
  userId: string,
  input: {
    repo: string;
    analysisId?: string;
    itemRank?: number;
    provider?: ExternalPromptProvider;
  },
): Promise<ExternalCompletionPromptResult> {
  const provider = input.provider ?? "provider-neutral";
  const [reasoning, portfolio] = await Promise.all([
    reasonAboutRepositoryPlan(supabase, userId, {
      repo: input.repo,
      requestedNextSteps: [],
      analysisId: input.analysisId,
      itemRank: input.itemRank,
      mode: "plan",
    }),
    loadPortfolioSnapshot(supabase, userId, input.analysisId, input.repo),
  ]);

  const { repository, treeSignals } = reasoning.evidence;
  const stage = portfolio
    ? `Completion ${pct(portfolio.completionPct)}; production readiness ${pct(portfolio.productionReadinessPct)}; commercialization probability ${pct(portfolio.commercializationProbability)}.`
    : "No saved portfolio score is available; derive completion/readiness from current repository and runtime evidence before implementation.";
  const providerNote = providerInstructions(provider);

  const prompt = `# FULL REPOSITORY COMPLETION MISSION — ${input.repo}

You are the senior principal engineer and autonomous completion agent responsible for taking this repository from its CURRENT verified state to a genuinely finished, tested, secure, deployable, maintainable product.

This is a current-state handoff generated by RepoFinisher. It is intentionally detailed, but it is NOT permission to trust stale assumptions. Validate everything against the repository and connected runtime before making changes.

## 1. REPOSITORY IDENTITY AND BASELINE

Repository: ${input.repo}
Default branch: ${repository.defaultBranch}
Assessment head SHA: ${repository.headSha}
Primary language: ${repository.language ?? "unknown"}
Description: ${repository.description ?? "none supplied"}
Archived: ${repository.archived ? "yes" : "no"}
Stars/forks/open issues: ${repository.stars}/${repository.forks}/${repository.openIssues}

IMPORTANT BASELINE RULE:
Before editing, resolve the current default-branch HEAD. If it is not ${repository.headSha}, inspect the changes since this assessment and re-evaluate the plan before writing. Never overwrite newer work to force this prompt to fit.

## 2. CURRENT STAGE

${stage}
${portfolio ? `Current planning value range: ${moneyRange(portfolio.presentValueUsd)}.\nPotential planning value range: ${moneyRange(portfolio.potentialValueUsd)}.\nFinish-first score: ${portfolio.finishFirstScore ?? "not measured"}.\nEstimated remaining engineering work: ${portfolio.remainingHours ?? "not measured"} hours.\nEvidence confidence: ${pct(portfolio.evidenceConfidence)}.` : ""}

RepoFinisher reasoning confidence: ${reasoning.confidence}/100.
This is a planning estimate, not proof of business revenue or customer demand.

## 3. VERIFIED STRUCTURAL SIGNALS

- Automated tests detected: ${treeSignals.hasTests ? "yes" : "no"}
- CI detected: ${treeSignals.hasCi ? "yes" : "no"}
- Docker/container signals: ${treeSignals.hasDocker ? "yes" : "no"}
- Database/migration signals: ${treeSignals.hasDatabaseMigrations ? "yes" : "no"}
- Authentication/authorization signals: ${treeSignals.hasAuthSignals ? "yes" : "no"}
- Payments/billing signals: ${treeSignals.hasPaymentsSignals ? "yes" : "no"}
- Frontend signals: ${treeSignals.hasFrontendSignals ? "yes" : "no"}
- Backend/API signals: ${treeSignals.hasBackendSignals ? "yes" : "no"}
- Repository file count observed: ${treeSignals.fileCount}

Do not infer that a capability works merely because files exist. Prove behavior with tests, runtime checks, or deployment evidence.

## 4. CURRENT ROOT-CAUSE ASSESSMENT

${reasoning.summary}

Specialist lenses selected by current evidence: ${reasoning.specialists.length ? reasoning.specialists.join(", ") : "general principal-engineering review"}.

## 5. ORDERED COMPLETION WORK

Execute these as evidence-driven objectives, not as blind instructions. Re-check each one against current code before editing. Prerequisites come before dependent work.

${bulletList(reasoning.nextSteps)}

## 6. KNOWN RISKS / REGRESSION AREAS

${bulletList(reasoning.risks)}

## 7. REQUIRED VALIDATION

A change is not complete because code was written. Require observable evidence.

${bulletList(reasoning.validation)}

Additionally, before declaring the repository finished:
- Run the repository's existing tests, typecheck/static checks, lint where configured, and production build.
- Do NOT weaken, delete, skip, mute, or rewrite tests/CI/security controls merely to obtain green checks.
- If CI fails, read the actual failed check/job logs, diagnose root cause, make the smallest safe repair, rerun, and do not repeat an unchanged failed repair.
- Validate migrations against disposable/non-production infrastructure first where applicable. Check idempotency, ordering, RLS/data isolation, indexes, and rollback/forward-recovery safety.
- Validate the primary user journey end to end. For a UI product, include responsive/mobile behavior, loading/empty/error states, navigation and accessibility basics. For an API/worker, validate contracts, error behavior, concurrency/idempotency and operational failure handling.
- If authentication exists, verify both authenticated and unauthorized boundaries without exposing credentials.
- If billing/payments exist, use safe test/sandbox modes unless explicitly operating in an approved live environment.
- Build a deployment/preview and smoke-test the actual running product when deployment tooling is available.
- Check logs/observability for new runtime errors after deployment.
- Remove placeholders, fake success states, dead critical navigation, broken links, unfinished TODO behavior and debug-only paths that block the intended product.
- Update README/operator documentation and environment templates when setup or behavior materially changes.
- Never put secrets, tokens, private keys, production .env values or credentials into source, logs, commits, PR descriptions or this chat.

## 8. ITERATIVE COMPLETION LOOP

Do NOT stop after one patch if the product remains materially unfinished.

Repeat this loop:
1. Inspect current code, configuration, tests, CI, open product gaps and deployment evidence.
2. Identify the highest-impact VERIFIED blocker and its root cause.
3. Form at least one plausible fix and actively look for evidence that would disprove it.
4. Implement the smallest coherent safe batch that materially improves completion/readiness.
5. Run the relevant tests/checks/build and inspect actual failure output.
6. Repair root causes without weakening acceptance criteria.
7. Reassess the core user journey, security/data boundaries and deployment readiness.
8. Continue to the next verified blocker.
9. Stop only when the Definition of Done is met, or when an explicit stop condition is reached and clearly report the remaining blocker.

Do not churn. If two materially different attempts produce no measurable progress on the same blocker, stop broad guessing and re-diagnose from fresh evidence.

## 9. STOP CONDITIONS

${bulletList(reasoning.stopConditions)}

Also stop and report instead of guessing when:
- A required secret/account/production permission is unavailable.
- A destructive data migration cannot be validated safely.
- The current HEAD moved and your plan would overwrite or invalidate newer work.
- The requested behavior conflicts with verified product requirements or security controls.
- The remaining blocker depends on an external service you cannot safely inspect or test.

## 10. DEFINITION OF DONE

Do not call this repository “finished” unless, for its intended scope:
- The core user/business workflow works end to end.
- Known high-severity functional blockers are resolved.
- Tests and required CI checks pass without weakened acceptance criteria.
- Production build succeeds.
- Database migrations/data boundaries are validated where relevant.
- Authentication/authorization and secret handling are safe where relevant.
- Deployment configuration is reproducible and the deployed/preview surface is smoke-tested when available.
- Error/loading/empty/retry paths are usable rather than fake-success or dead-end states.
- Critical responsive/accessibility behavior is acceptable for user-facing apps.
- Monitoring/logging exposes meaningful failures for production-critical paths.
- Documentation/environment templates are sufficient for another competent engineer to run and operate it.
- There are no known critical TODOs/placeholders blocking the intended product.
- You can cite concrete test/build/deployment evidence for the completion claim.

## 11. WORKING METHOD FOR THIS EXTERNAL AGENT

${providerNote}

Do not ask the user to paste secrets into chat. If credentials are required, use the external agent/environment's secure secret mechanism or state exactly which named configuration is missing without exposing its value.

Preserve history and rollback boundaries. Prefer a dedicated branch and draft PR. Do not force-push shared branches. Do not auto-merge unless the user explicitly requests and the environment's review/CI policy allows it.

## 12. REQUIRED FINAL REPORT

When you finish, return:
1. Final current HEAD/branch and PR URL if created.
2. What was actually changed, grouped by root cause/product objective.
3. Exact tests/checks/builds run and their results.
4. Deployment/preview URL and smoke-test evidence if available.
5. Security/data/auth/payment validation performed, as applicable.
6. Before/after completion and readiness assessment with the evidence used.
7. Any remaining blockers or unverified areas—never conceal them behind a “done” claim.
8. Recommended next action only if the Definition of Done cannot yet be met.

Start by inspecting the repository at or after ${repository.headSha}, validating this assessment, and then execute the highest-priority verified completion work.`;

  return {
    prompt,
    provider,
    promptVersion: EXTERNAL_PROMPT_VERSION,
    assessment: {
      repo: input.repo,
      headSha: repository.headSha,
      defaultBranch: repository.defaultBranch,
      reasoningTraceId: reasoning.traceId,
      reasoningConfidence: reasoning.confidence,
      specialists: reasoning.specialists,
      treeSignals,
      portfolio,
      summary: reasoning.summary,
      nextSteps: reasoning.nextSteps,
      risks: reasoning.risks,
      validation: reasoning.validation,
      stopConditions: reasoning.stopConditions,
    },
  };
}
