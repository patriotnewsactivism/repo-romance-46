/**
 * Immutable, signed change plans and the approval contract that gates them.
 *
 * This module exists because the previous "finish this repo" path asked an LLM
 * for file contents and wrote them straight to the user's repository — no
 * record of what was approved, no binding between what was shown and what was
 * committed, and no distinction between adding a README and rewriting a CI
 * workflow.
 *
 * The contract here is deliberately strict:
 *
 *  - A plan is canonicalized and HMAC-signed. Any edit invalidates it.
 *  - Every change carries a SHA-256 of its exact content; execution refuses
 *    content that does not hash to what was approved.
 *  - Approval names exact paths. A path absent from the approval is never
 *    written, even if the plan contains it.
 *  - High-risk paths (CI, containers, manifests, lockfiles, auth, secrets)
 *    require a second, explicit consent flag.
 *  - The plan is bound to the base commit it was computed against; if the
 *    branch moved, the plan is stale and execution is refused.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type ChangeStatus = "created" | "modified" | "deleted";
export type PathRisk = "normal" | "high";

export const plannedChangeSchema = z.object({
  path: z.string().min(1).max(400),
  status: z.enum(["created", "modified", "deleted"]),
  /** SHA-256 of the exact file content this change will write. Empty for deletions. */
  contentSha256: z.string().regex(/^[a-f0-9]{64}$|^$/),
  description: z.string().min(1).max(500),
  risk: z.enum(["normal", "high"]),
});

export type PlannedChange = z.infer<typeof plannedChangeSchema>;

export const planDocumentSchema = z.object({
  planId: z.string().min(8).max(120),
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  baseBranch: z.string().min(1).max(255),
  /** The commit the plan was computed against. */
  baseCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
  summary: z.string().min(1).max(4000),
  milestone: z.string().max(200).optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  changes: z.array(plannedChangeSchema).min(1).max(100),
});

export type PlanDocument = z.infer<typeof planDocumentSchema>;

export const approvalRecordSchema = z.object({
  planId: z.string().min(8).max(120),
  approvedBy: z.string().min(1).max(200),
  approvedAt: z.string().datetime(),
  /** Exact paths the user approved. Anything else in the plan is dropped. */
  approvedPaths: z.array(z.string().min(1)).min(1).max(100),
  /** Separate, explicit consent for the high-risk subset. */
  highRiskConsent: z.boolean(),
});

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

/**
 * Paths where a bad write is expensive or hard to notice: it can exfiltrate
 * secrets on the next CI run, change what gets deployed, or alter the
 * dependency graph.
 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /^\.github\/workflows\//i,
  /^\.github\/actions\//i,
  /^\.gitlab-ci\.yml$/i,
  /(^|\/)dockerfile(\.|$)/i,
  /^docker-compose(\.|$)/i,
  /(^|\/)package\.json$/i,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|gemfile\.lock)$/i,
  /(^|\/)\.env($|\.)/i,
  /(^|\/)(vercel\.json|render\.yaml|netlify\.toml|firebase\.json|fly\.toml|cloudbuild\.yaml|app\.yaml|serverless\.yml)$/i,
  /\.(tf|tfvars)$/i,
  /(^|\/)(auth|authentication|authorization|security|secrets?|credentials?)[^/]*\.[a-z]+$/i,
  /(^|\/)middlewares?\/auth/i,
  /(^|\/)migrations?\//i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)Makefile$/i,
];

export function classifyPathRisk(path: string): PathRisk {
  return HIGH_RISK_PATTERNS.some((re) => re.test(path)) ? "high" : "normal";
}

/**
 * Reject anything that could escape the repository root or touch git internals.
 * Returns the normalized path, or throws.
 */
export function assertSafeRepoPath(path: string): string {
  if (path.length === 0 || path.length > 400) throw new Error(`Unsafe path: ${JSON.stringify(path)} (bad length)`);
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) throw new Error(`Unsafe path: ${path} (absolute)`);
  if (path.includes("\\")) throw new Error(`Unsafe path: ${path} (backslash)`);
  if (path.includes("\0")) throw new Error(`Unsafe path: ${path} (null byte)`);

  const segments = path.split("/");
  if (segments.some((s) => s === "." || s === ".." || s === "")) {
    throw new Error(`Unsafe path: ${path} (traversal or empty segment)`);
  }
  if (segments[0] === ".git") throw new Error(`Unsafe path: ${path} (git internals)`);
  return segments.join("/");
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Deterministic serialization: object keys sorted at every level, so two
 * structurally identical plans always produce the same signature.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export function signPlan(plan: PlanDocument, secret: string): string {
  if (!secret) throw new Error("A signing secret is required to sign a plan");
  return createHmac("sha256", secret).update(canonicalize(plan), "utf8").digest("hex");
}

export function verifyPlanSignature(plan: PlanDocument, signature: string, secret: string): boolean {
  const expected = signPlan(plan, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature ?? "", "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface BuildPlanInput {
  planId: string;
  repo: string;
  baseBranch: string;
  baseCommitSha: string;
  summary: string;
  milestone?: string;
  changes: { path: string; status: ChangeStatus; content: string; description: string }[];
  ttlMinutes?: number;
  now?: Date;
}

const DEFAULT_TTL_MINUTES = 60;

/**
 * Build a plan document from proposed file contents. The contents themselves
 * are *not* stored in the plan — only their hashes — so an approval record can
 * be persisted cheaply and the signature covers exactly what will be written.
 */
export function buildPlan(input: BuildPlanInput): PlanDocument {
  const now = input.now ?? new Date();
  const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;

  const changes: PlannedChange[] = input.changes.map((change) => {
    const path = assertSafeRepoPath(change.path);
    return {
      path,
      status: change.status,
      contentSha256: change.status === "deleted" ? "" : sha256(change.content),
      description: change.description.slice(0, 500),
      risk: classifyPathRisk(path),
    };
  });

  const seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.path)) throw new Error(`Plan contains duplicate path: ${change.path}`);
    seen.add(change.path);
  }

  return planDocumentSchema.parse({
    planId: input.planId,
    repo: input.repo,
    baseBranch: input.baseBranch,
    baseCommitSha: input.baseCommitSha,
    summary: input.summary,
    ...(input.milestone ? { milestone: input.milestone } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
    changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
  });
}

export type AuthorizationFailure =
  | "invalid-signature"
  | "plan-expired"
  | "approval-plan-mismatch"
  | "base-commit-drift"
  | "no-approved-paths"
  | "unapproved-path"
  | "high-risk-consent-missing"
  | "content-hash-mismatch";

export interface AuthorizationResult {
  ok: boolean;
  failure?: AuthorizationFailure;
  message?: string;
  /** Only the changes that survived every check. */
  authorizedChanges: PlannedChange[];
  /** Approved-but-not-executed paths, e.g. dropped for consent reasons. */
  skipped: { path: string; reason: string }[];
}

/**
 * The single gate every repository write must pass.
 *
 * `currentHeadSha` is read from GitHub immediately before execution: if the
 * branch advanced since the plan was built, the diff the user approved is no
 * longer the diff that would be produced, so the plan is refused.
 */
export function authorizeExecution(params: {
  plan: PlanDocument;
  signature: string;
  secret: string;
  approval: ApprovalRecord;
  currentHeadSha: string;
  /** Actual content about to be written, keyed by path. Hashes must match the plan. */
  contents: Map<string, string>;
  now?: Date;
}): AuthorizationResult {
  const now = params.now ?? new Date();
  const fail = (failure: AuthorizationFailure, message: string): AuthorizationResult => ({
    ok: false,
    failure,
    message,
    authorizedChanges: [],
    skipped: [],
  });

  if (!verifyPlanSignature(params.plan, params.signature, params.secret)) {
    return fail("invalid-signature", "Plan signature does not match — the plan was altered after approval");
  }
  if (new Date(params.plan.expiresAt).getTime() <= now.getTime()) {
    return fail("plan-expired", `Plan expired at ${params.plan.expiresAt}`);
  }
  if (params.approval.planId !== params.plan.planId) {
    return fail("approval-plan-mismatch", "Approval record refers to a different plan");
  }
  if (params.plan.baseCommitSha !== params.currentHeadSha) {
    return fail(
      "base-commit-drift",
      `Plan was built against ${params.plan.baseCommitSha.slice(0, 7)} but ${params.plan.baseBranch} is now at ${params.currentHeadSha.slice(0, 7)} — re-plan against the current head`,
    );
  }

  const approvedPaths = new Set(params.approval.approvedPaths);
  const planPaths = new Set(params.plan.changes.map((c) => c.path));
  for (const path of approvedPaths) {
    if (!planPaths.has(path)) {
      return fail("unapproved-path", `Approval names ${path}, which is not part of this plan`);
    }
  }

  const authorizedChanges: PlannedChange[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const change of params.plan.changes) {
    if (!approvedPaths.has(change.path)) {
      skipped.push({ path: change.path, reason: "not approved" });
      continue;
    }
    if (change.risk === "high" && !params.approval.highRiskConsent) {
      return fail(
        "high-risk-consent-missing",
        `${change.path} is a high-risk path and requires explicit high-risk consent`,
      );
    }
    if (change.status !== "deleted") {
      const content = params.contents.get(change.path);
      if (content === undefined) {
        return fail("content-hash-mismatch", `No content supplied for approved path ${change.path}`);
      }
      if (sha256(content) !== change.contentSha256) {
        return fail(
          "content-hash-mismatch",
          `Content for ${change.path} does not match what was approved — refusing to write substituted content`,
        );
      }
    }
    authorizedChanges.push(change);
  }

  if (authorizedChanges.length === 0) {
    return fail("no-approved-paths", "Nothing in this plan was approved");
  }

  return { ok: true, authorizedChanges, skipped };
}

/** Paths in a plan that need the separate high-risk consent. */
export function highRiskPaths(plan: PlanDocument): string[] {
  return plan.changes.filter((c) => c.risk === "high").map((c) => c.path);
}
