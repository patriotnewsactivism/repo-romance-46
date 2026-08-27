/**
 * Approval-gated repository changes.
 *
 * The route this replaces (`POST /repo-finisher/finish`) asked an LLM for whole
 * file contents and then wrote them straight to the caller's repository —
 * creating a branch, committing each file, and opening a PR — with no record of
 * what anyone approved and no distinction between adding a README and
 * rewriting a CI workflow. A prompt-injected repository could get arbitrary
 * content committed to another repository the token could reach.
 *
 * It is now three steps:
 *
 *   POST /repo-finisher/plan     → proposes changes, writes nothing, returns a
 *                                  signed immutable plan bound to the base commit
 *   POST /repo-finisher/preview  → returns the proposed content for one path
 *   POST /repo-finisher/execute  → verifies signature, approval, base commit and
 *                                  per-file content hashes, then writes ONE commit
 *                                  and opens a DRAFT pull request
 *
 * The signature makes the plan tamper-evident, so it can travel through the
 * client without a server-side store: nothing is written that the server did
 * not itself sign, to a path the user did not explicitly name.
 */

import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  approvalRecordSchema,
  authorizeExecution,
  buildPlan,
  highRiskPaths,
  planDocumentSchema,
  signPlan,
  type PlanDocument,
} from "@workspace/repo-os";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { config, requireConfig } from "../lib/config";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import {
  assertRepoSlug,
  createAtomicCommit,
  createDraftPullRequest,
  getBranchHeadSha,
  getFileContent,
  getRepo,
  getRepoTree,
} from "../lib/github";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** How many repository files the planner is allowed to read. */
const MAX_CONTEXT_FILES = 15;
const MAX_FILE_CHARS = 3_000;

interface ProposedChange {
  path: string;
  status: "created" | "modified" | "deleted";
  content: string;
  description: string;
}

const proposalSchema = z.object({
  analysis: z.string(),
  changes: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["created", "modified", "deleted"]),
      content: z.string(),
      description: z.string(),
    }),
  ),
});

const PLANNER_SYSTEM = `You are a senior engineer proposing a minimal, reviewable change set for a repository.

You are producing a PROPOSAL. Nothing you return is written anywhere until a
human approves each specific file path, so describe changes honestly rather
than optimistically.

## Reason before you propose
1. Read the supplied source files and health flags and identify the SPECIFIC
   gaps blocking this repository from shipping — not a generic checklist.
2. Weigh what is safe to add against what is risky to touch. Never rewrite
   working logic, and never break existing exports, imports or tests.
3. Decide the smallest set of file changes that closes the gaps you actually
   found. Speculative changes will be rejected by the reviewer.

## Rules
- Every change must include the FULL file content, not a diff.
- For "modified", output the complete updated file.
- For "deleted", set content to an empty string.
- Prefer additive changes (README, LICENSE, CI, tests) over edits to logic.
- Do not touch more files than the gaps require.

Return JSON with:
- analysis: what is wrong and what this change set fixes (3–5 sentences)
- changes: array of { path, status, content, description }`;

async function gatherContextFiles(token: string, repo: string, branch: string): Promise<{ path: string; content: string }[]> {
  const tree = await getRepoTree(token, repo, branch);

  const priority = [
    /^readme/i,
    /^package\.json$/,
    /^pyproject\.toml$/,
    /^Cargo\.toml$/,
    /^go\.mod$/,
    /^requirements.*\.txt$/,
    /^tsconfig\.json$/,
    /^vite\.config\./,
    /^next\.config\./,
    /^Dockerfile$/,
    /^Makefile$/,
    /^\.(env\.example|gitignore)/,
    /^src\/(index|main|app|server|cli)\.[tj]sx?$/,
    /^src\/(index|main|app|server|cli)\.py$/,
    /\.test\.[tj]sx?$/,
  ];

  const picked: string[] = [];
  for (const pattern of priority) {
    for (const node of tree) {
      if (picked.length >= MAX_CONTEXT_FILES) break;
      if (pattern.test(node.path) && !picked.includes(node.path)) picked.push(node.path);
    }
    if (picked.length >= MAX_CONTEXT_FILES) break;
  }
  for (const node of tree) {
    if (picked.length >= MAX_CONTEXT_FILES) break;
    if (node.path.startsWith("src/") && /\.(ts|tsx|js|jsx|py|go|rs)$/.test(node.path) && !picked.includes(node.path)) {
      picked.push(node.path);
    }
  }

  const files: { path: string; content: string }[] = [];
  for (const path of picked) {
    const content = await getFileContent(token, repo, path, branch);
    if (content !== null) files.push({ path, content: content.slice(0, MAX_FILE_CHARS) });
  }
  return files;
}

async function proposeChanges(params: {
  repo: string;
  branch: string;
  token: string;
  provider: string;
  apiKey: string | null;
  goals: string[];
}): Promise<{ analysis: string; changes: ProposedChange[] }> {
  const meta = await getRepo(params.token, params.repo);
  const tree = await getRepoTree(params.token, params.repo, params.branch);
  const files = await gatherContextFiles(params.token, params.repo, params.branch);

  const health = {
    hasCi: tree.some((t) => t.path.startsWith(".github/workflows/")),
    hasTests: tree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path)),
    hasLicense: Boolean(meta.license),
    hasReadme: tree.some((t) => /^readme/i.test(t.path)),
  };

  const user = `Repo: ${params.repo}
Description: ${meta.description || "none"}
Language: ${meta.language || "unknown"}
Topics: ${(meta.topics ?? []).join(", ") || "none"}
Stars: ${meta.stargazers_count} | Open issues: ${meta.open_issues_count}
Health: CI=${health.hasCi}, Tests=${health.hasTests}, License=${health.hasLicense}, README=${health.hasReadme}

Approved goals for this change set:
${params.goals.map((g) => `- ${g}`).join("\n")}

Current source files (${files.length} of ${tree.length} total):
${files.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n")}`;

  const result = await callAI(
    {
      messages: [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "change_proposal",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              analysis: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string" },
                    status: { type: "string", enum: ["created", "modified", "deleted"] },
                    content: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["path", "status", "content", "description"],
                },
              },
            },
            required: ["analysis", "changes"],
          },
        },
      },
    },
    { provider: params.provider, apiKey: params.apiKey },
  );

  const parsed = proposalSchema.safeParse(JSON.parse(result.content || "{}"));
  if (!parsed.success) {
    throw Object.assign(new Error("The model returned a malformed change proposal"), { status: 502 });
  }
  return parsed.data;
}

const DEFAULT_GOALS = [
  "Add a comprehensive README with installation and usage instructions",
  "Add a LICENSE file",
  "Set up basic CI",
  "Add basic tests",
  "Fix obvious bugs or incomplete implementations",
];

router.post(
  "/repo-finisher/plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        repo: z.string(),
        goals: z.array(z.string().max(500)).max(20).optional(),
        analysisId: z.string().uuid().optional(),
        itemRank: z.number().int().optional(),
      })
      .parse(req.body);

    const repo = assertRepoSlug(input.repo);
    const secret = requireConfig(config.planSigningSecret, "PLAN_SIGNING_SECRET");

    const credential = requireGithubCredential(await loadGithubCredential(req.supabase!, req.userId!));
    const ai = await loadAiCredential(req.supabase!, req.userId!, credential.token);

    let goals = input.goals ?? [];
    if (goals.length === 0 && input.analysisId && input.itemRank !== undefined) {
      const { data: item } = await req.supabase!
        .from("analysis_items")
        .select("next_steps")
        .eq("analysis_id", input.analysisId)
        .eq("rank", input.itemRank)
        .maybeSingle();
      const steps = (item as { next_steps?: string[] } | null)?.next_steps;
      if (Array.isArray(steps)) goals = steps;
    }
    if (goals.length === 0) goals = DEFAULT_GOALS;

    const meta = await getRepo(credential.token, repo);
    const baseBranch = meta.default_branch;
    // Bind the plan to the exact commit it was reasoned about. If the branch
    // moves before execution, the approved diff is no longer the diff that
    // would be produced, and execution is refused.
    const baseCommitSha = await getBranchHeadSha(credential.token, repo, baseBranch);

    const proposal = await proposeChanges({
      repo,
      branch: baseBranch,
      token: credential.token,
      provider: ai.provider,
      apiKey: ai.apiKey,
      goals,
    });

    if (proposal.changes.length === 0) {
      throw Object.assign(new Error("No changes proposed — the repository may already be in good shape."), {
        status: 422,
      });
    }

    const plan = buildPlan({
      planId: `plan_${randomUUID()}`,
      repo,
      baseBranch,
      baseCommitSha,
      summary: proposal.analysis,
      changes: proposal.changes,
    });

    logger.info(
      { event: "plan.created", planId: plan.planId, repo, userId: req.userId, changeCount: plan.changes.length },
      "Change plan created",
    );

    res.json({
      plan,
      signature: signPlan(plan, secret),
      highRiskPaths: highRiskPaths(plan),
      // Contents travel with the proposal so the user can review the exact
      // bytes they are approving; the plan itself carries only their hashes.
      proposedContents: Object.fromEntries(proposal.changes.map((c) => [c.path, c.content])),
    });
  }),
);

router.post(
  "/repo-finisher/execute",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        plan: planDocumentSchema,
        signature: z.string().min(32),
        approval: approvalRecordSchema.omit({ approvedBy: true, approvedAt: true }),
        contents: z.record(z.string(), z.string()),
      })
      .parse(req.body);

    const secret = requireConfig(config.planSigningSecret, "PLAN_SIGNING_SECRET");
    const plan: PlanDocument = input.plan;
    const repo = assertRepoSlug(plan.repo);

    const credential = requireGithubCredential(await loadGithubCredential(req.supabase!, req.userId!));

    // Re-read the branch head immediately before writing, so a push that landed
    // between planning and approval invalidates the plan rather than silently
    // rebasing someone's approval onto different code.
    const currentHeadSha = await getBranchHeadSha(credential.token, repo, plan.baseBranch);

    const authorization = authorizeExecution({
      plan,
      signature: input.signature,
      secret,
      approval: {
        ...input.approval,
        approvedBy: req.userId!,
        approvedAt: new Date().toISOString(),
      },
      currentHeadSha,
      contents: new Map(Object.entries(input.contents)),
    });

    if (!authorization.ok) {
      logger.warn(
        { event: "plan.rejected", planId: plan.planId, repo, userId: req.userId, failure: authorization.failure },
        "Execution refused",
      );
      throw Object.assign(new Error(authorization.message ?? "Execution refused"), {
        status: authorization.failure === "base-commit-drift" ? 409 : 403,
      });
    }

    const branch = `repo-romance/${plan.planId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
    const commitMessage = [
      `repo-romance: ${authorization.authorizedChanges.length} approved change(s)`,
      "",
      plan.summary.slice(0, 2_000),
      "",
      ...authorization.authorizedChanges.map((c) => `- ${c.status} ${c.path} — ${c.description}`),
    ].join("\n");

    const commit = await createAtomicCommit(credential.token, repo, {
      baseSha: plan.baseCommitSha,
      newBranch: branch,
      message: commitMessage,
      changes: authorization.authorizedChanges.map((change) => ({
        path: change.path,
        ...(change.status === "deleted" ? {} : { content: input.contents[change.path] ?? "" }),
      })),
    });

    const pr = await createDraftPullRequest(credential.token, repo, {
      head: branch,
      base: plan.baseBranch,
      title: `Repo Romance: ${authorization.authorizedChanges.length} approved change(s)`,
      body: renderPullRequestBody(plan, authorization.authorizedChanges, authorization.skipped, req.userId!),
    });

    logger.info(
      {
        event: "plan.executed",
        planId: plan.planId,
        repo,
        userId: req.userId,
        branch,
        commitSha: commit.commitSha,
        prNumber: pr.number,
        paths: authorization.authorizedChanges.map((c) => c.path),
      },
      "Approved change set committed",
    );

    const result = {
      repo,
      planId: plan.planId,
      branch,
      commit_sha: commit.commitSha,
      pr_url: pr.html_url,
      pr_number: pr.number,
      files_changed: authorization.authorizedChanges.length,
      summary: plan.summary,
      changes: authorization.authorizedChanges.map((c) => ({
        file: c.path,
        status: c.status,
        description: c.description,
      })),
      skipped: authorization.skipped,
    };

    res.json(result);
  }),
);

function renderPullRequestBody(
  plan: PlanDocument,
  applied: { path: string; status: string; description: string }[],
  skipped: { path: string; reason: string }[],
  approvedBy: string,
): string {
  return `## Summary

${plan.summary}

## Approved goal

Plan \`${plan.planId}\`, approved by user \`${approvedBy}\`, bound to \`${plan.baseBranch}\` at \`${plan.baseCommitSha.slice(0, 7)}\`.

## Files changed

${applied.map((c) => `- \`${c.path}\` (${c.status}) — ${c.description}`).join("\n")}

${skipped.length > 0 ? `## Proposed but not approved\n\n${skipped.map((s) => `- \`${s.path}\` — ${s.reason}`).join("\n")}\n` : ""}
## Verification

Every file in this commit hashes to the content that was approved, and the
commit's parent is the exact commit the plan was built against. No file outside
the approved list was written.

## Known risks

This change set has not been built or tested by Repo Romance — that is what CI
on this pull request is for. Review the diff before marking it ready.

## Rollback plan

Close this pull request and delete the branch; nothing was merged.
`;
}

router.get(
  "/repo-finisher/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { repo } = z.object({ repo: z.string() }).parse(req.query);
    assertRepoSlug(repo);

    const { data: items } = await req.supabase!
      .from("analysis_items")
      .select("finish_result, title, rank")
      .contains("repos", [repo])
      .eq("user_id", req.userId!)
      .order("rank", { ascending: true });

    const finished = (items ?? []).filter((i) => (i as Record<string, unknown>)["finish_result"]);

    res.json({
      repo,
      hasBeenFinished: finished.length > 0,
      finishes: finished.map((i) => (i as Record<string, unknown>)["finish_result"]),
    });
  }),
);

export default router;
