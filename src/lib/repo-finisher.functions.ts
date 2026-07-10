import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, resolveAIConfig, type AIProviderConfig } from "@/lib/ai-provider";

// ─── Types ─────────────────────────────────────────────────────

interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

interface FinishResult {
  repo: string;
  branch: string;
  pr_url: string;
  pr_number: number;
  files_changed: number;
  additions: number;
  deletions: number;
  summary: string;
  changes: {
    file: string;
    status: "created" | "modified" | "deleted";
    description: string;
  }[];
}

// ─── GitHub API helpers ────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
  };
}

async function ghFetch(token: string, path: string, opts?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { ...ghHeaders(token), ...(opts?.headers || {}) },
  });
  return res;
}

async function getRepoTree(token: string, repo: string, branch: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/trees/${branch}?recursive=1`);
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  const json = (await res.json()) as {
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    truncated: boolean;
  };
  return json;
}

async function getFileContent(
  token: string,
  repo: string,
  path: string,
): Promise<GitHubFile | null> {
  const res = await ghFetch(token, `/repos/${repo}/contents/${path}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; sha: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { path, content, sha: json.sha };
}

// ─── Parallel file fetching ────────────────────────────────────

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Git Data API: batch commit in a single API call ───────────
// Instead of committing files one by one (N API calls), we create
// a single tree with all changes and one commit. This is both faster
// and atomic.

async function batchCommit(
  token: string,
  repo: string,
  baseBranch: string,
  newBranch: string,
  changes: AIFileChange[],
): Promise<{ commitSha: string; filesChanged: number }> {
  // 1. Get the base branch SHA
  const refRes = await ghFetch(token, `/repos/${repo}/git/refs/heads/${baseBranch}`);
  if (!refRes.ok) throw new Error(`Failed to get base branch: ${refRes.status}`);
  const ref = (await refRes.json()) as { object: { sha: string } };
  const baseSha = ref.object.sha;

  // 2. Get the base commit's tree SHA
  const commitRes = await ghFetch(token, `/repos/${repo}/git/commits/${baseSha}`);
  if (!commitRes.ok) throw new Error(`Failed to get base commit: ${commitRes.status}`);
  const baseCommit = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Build the tree entries for new/modified files
  // For deletions, we use mode "100644" with sha=null
  const treeEntries: Array<{
    path: string;
    mode: string;
    type: string;
    sha?: string | null;
  }> = [];

  // For created/modified files, we need to create blobs first
  const blobPromises = changes
    .filter((c) => c.status !== "deleted")
    .map(async (c) => {
      const blobRes = await ghFetch(token, `/repos/${repo}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: c.content,
          encoding: "utf-8",
        }),
      });
      if (!blobRes.ok) throw new Error(`Failed to create blob for ${c.path}: ${blobRes.status}`);
      const blob = (await blobRes.json()) as { sha: string };
      return { path: c.path, sha: blob.sha };
    });

  const blobResults = await Promise.all(blobPromises.map((p, i) => p.catch(() => null)));

  let filesChanged = 0;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (change.status === "deleted") {
      // For deletions, we need to get the file's blob SHA first
      const existing = await getFileContent(token, repo, change.path);
      if (existing) {
        treeEntries.push({
          path: change.path,
          mode: "100644",
          type: "blob",
          sha: null as unknown as string, // null sha = delete
        });
        filesChanged++;
      }
    } else {
      const blob = blobResults[i];
      if (blob) {
        treeEntries.push({
          path: change.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        });
        filesChanged++;
      }
    }
  }

  if (filesChanged === 0) throw new Error("No files could be committed");

  // 4. Create the new tree
  const treeRes = await ghFetch(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  if (!treeRes.ok) throw new Error(`Failed to create tree: ${treeRes.status}`);
  const tree = (await treeRes.json()) as { sha: string };

  // 5. Create the commit pointing to the new tree
  const commitRes2 = await ghFetch(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `repo-finisher: ${filesChanged} improvement${filesChanged > 1 ? "s" : ""}`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });
  if (!commitRes2.ok) throw new Error(`Failed to create commit: ${commitRes2.status}`);
  const newCommit = (await commitRes2.json()) as { sha: string };

  // 6. Create the branch pointing to the new commit
  const branchRes = await ghFetch(token, `/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/heads/${newBranch}`,
      sha: newCommit.sha,
    }),
  });
  if (!branchRes.ok) {
    if (branchRes.status === 422) throw new Error(`Branch "${newBranch}" already exists`);
    const err = await branchRes.text();
    throw new Error(`Failed to create branch: ${branchRes.status} ${err.slice(0, 200)}`);
  }

  return { commitSha: newCommit.sha, filesChanged };
}

// ─── AI code generation ────────────────────────────────────────

interface AIFileChange {
  path: string;
  status: "created" | "modified" | "deleted";
  content: string;
  description: string;
}

interface AIFinishPlan {
  analysis: string;
  changes: AIFileChange[];
}

const FINISH_SYSTEM_PROMPT = `You are a meticulous senior software engineer finishing incomplete codebases.
You are given a repo's metadata, health check, and ACTUAL source files. Your job is to produce targeted, high-quality improvements.

STRICT RULES:
1. Only suggest changes you are CONFIDENT about based on the actual code you can see.
2. For "modified" files, output the COMPLETE updated file — do not use diffs or partial content.
3. For "created" files, output the full new file with working, production-ready code.
4. Do NOT rewrite files that are already fine. Only touch files that need fixing.
5. Each change must have a specific, concrete description explaining WHAT you changed and WHY.

QUALITY GATES — only include a change if it meets ALL of:
- The change is based on something you can actually see in the provided files (not assumed).
- The change makes the repo closer to shippable (not just cosmetic).
- The file content you output is syntactically valid and complete.
- The change is scoped — don't rewrite an entire file just to add one import.

PRIORITY (do the most impactful things first):
1. Fix broken imports, missing exports, stub functions that are called but not implemented.
2. Add or fix README.md with real installation/usage based on the actual package.json or entry point.
3. Add LICENSE (MIT) if missing.
4. Add .github/workflows/ci.yml with basic CI (install deps + lint + test) based on the actual language/framework.
5. Add basic tests for the main entry point or key functions.
6. Fix obvious security issues (hardcoded secrets, missing input validation).

DO NOT:
- Add comments or documentation to files that don't need it.
- Change formatting or style of existing code.
- Add dependencies that aren't needed.
- Create files for features the repo doesn't have.
- Output more than 8 file changes. Focus on the highest-impact improvements.

Return JSON with:
- analysis: 3-5 sentences explaining what was wrong (be specific — reference actual files and code you saw).
- changes: array of { path, status, content, description } — only include changes you are confident about.`;

async function generateFinishPlan(
  repo: string,
  repoData: {
    description: string | null;
    language: string | null;
    default_branch: string;
    topics: string[];
    stars: number;
    open_issues: number;
    has_ci: boolean;
    has_tests: boolean;
    has_license: boolean;
    has_readme: boolean;
    has_homepage: boolean;
    file_count: number;
    key_directories: string[];
  },
  files: { path: string; content: string }[],
  nextSteps: string[],
  aiConfig: AIProviderConfig,
): Promise<AIFinishPlan> {
  // Build file summaries — show more of each file since the AI needs full context
  const MAX_FILE_CHARS = 4000;
  const fileSummaries = files
    .map((f) => {
      const content = f.content.slice(0, MAX_FILE_CHARS);
      const truncated = f.content.length > MAX_FILE_CHARS ? " [TRUNCATED]" : "";
      return `--- FILE: ${f.path}${truncated} ---\n${content}`;
    })
    .join("\n\n");

  const healthStr = [
    `CI: ${repoData.has_ci ? "present" : "MISSING"}`,
    `Tests: ${repoData.has_tests ? "present" : "MISSING"}`,
    `License: ${repoData.has_license ? "present" : "MISSING"}`,
    `README: ${repoData.has_readme ? "present" : "MISSING"}`,
    `Homepage: ${repoData.has_homepage ? "yes" : "no"}`,
  ].join(" | ");

  const user = `Repo: ${repo}
Description: ${repoData.description || "none"}
Language: ${repoData.language || "unknown"}
Topics: ${repoData.topics.join(", ") || "none"}
Stars: ${repoData.stars} | Open Issues: ${repoData.open_issues} | Total files: ${repoData.file_count}
Key directories: ${repoData.key_directories.join(", ") || "none"}

HEALTH CHECK: ${healthStr}

Recommended next steps (from portfolio analysis):
${nextSteps.map((s) => `- ${s}`).join("\n")}

Current source files (${files.length} files provided):
${fileSummaries}`;

  const aiResult = await callAI(
    {
      messages: [
        { role: "system", content: FINISH_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "finish_plan",
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
    aiConfig,
  );

  const plan = JSON.parse(aiResult.content || "{}") as AIFinishPlan;

  // Validate the plan
  if (!plan.changes || !Array.isArray(plan.changes)) {
    throw new Error("AI returned an invalid finish plan — no changes array.");
  }

  // Filter out obviously bad changes
  const validChanges = plan.changes.filter((c) => {
    if (!c.path || typeof c.path !== "string") return false;
    if (c.status === "deleted" && (!c.description || c.description.length < 5)) return false;
    if (c.status !== "deleted" && (!c.content || c.content.length < 10)) return false;
    // Reject changes to node_modules, .git, etc.
    if (c.path.includes("node_modules") || c.path.includes(".git/")) return false;
    return true;
  });

  if (validChanges.length === 0) {
    throw new Error(
      "AI didn't produce any valid changes — the repo might already be in good shape, or the AI couldn't find concrete improvements based on the provided files.",
    );
  }

  // Cap at 8 changes to keep PRs focused
  plan.changes = validChanges.slice(0, 8);
  return plan;
}

// ─── Fetch key files from repo (parallel) ──────────────────────

async function fetchKeyFiles(
  token: string,
  repo: string,
  branch: string,
  treeData: {
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    truncated: boolean;
  },
): Promise<{ path: string; content: string }[]> {
  const tree = treeData.tree.filter((t) => t.type === "blob");

  // Priority patterns for file selection
  const priorityPatterns = [
    /^readme/i,
    /^package\.json$/,
    /^pyproject\.toml$/,
    /^Cargo\.toml$/,
    /^go\.mod$/,
    /^requirements.*\.txt$/,
    /^setup\.py$/,
    /^tsconfig\.json$/,
    /^vite\.config\./,
    /^next\.config\./,
    /^Dockerfile$/,
    /^docker-compose/,
    /^Makefile$/,
    /^\.(env\.example|gitignore|eslintrc|prettierrc)/,
    /^src\/(index|main|app|server|cli)\.[tj]sx?$/,
    /^src\/(index|main|app|server|cli)\.py$/,
    /^lib\/(index|main)\.[tj]s$/,
    /^app\/(page|layout|route)/,
    /^api\/(index|main|server)/,
  ];

  const keyFiles: string[] = [];
  for (const pattern of priorityPatterns) {
    for (const node of tree) {
      if (pattern.test(node.path) && !keyFiles.includes(node.path)) {
        keyFiles.push(node.path);
        if (keyFiles.length >= 12) break;
      }
    }
    if (keyFiles.length >= 12) break;
  }

  // Also grab source files from src/ — prioritize larger files
  const srcFiles = tree
    .filter(
      (t) =>
        t.path.startsWith("src/") &&
        /\.(ts|tsx|js|jsx|py|go|rs)$/.test(t.path) &&
        !t.path.includes("node_modules") &&
        !t.path.includes("dist"),
    )
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 8)
    .map((t) => t.path);

  for (const f of srcFiles) {
    if (!keyFiles.includes(f)) keyFiles.push(f);
    if (keyFiles.length >= 18) break;
  }

  // Fetch contents IN PARALLEL (was sequential — major timeout cause)
  const fetchResults = await parallelMap(
    keyFiles.slice(0, 15),
    5, // 5 concurrent fetches
    (path) => getFileContent(token, repo, path),
  );

  const files: { path: string; content: string }[] = [];
  for (const result of fetchResults) {
    if (result.status === "fulfilled" && result.value) {
      files.push({ path: result.value.path, content: result.value.content });
    }
  }

  return files;
}

// ─── Timeout helper ────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s timeout.`)),
        ms,
      ),
    ),
  ]);
}

// ─── Main: Finish a repo ───────────────────────────────────────

export const finishRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { repo: string; nextSteps?: string[]; analysisId?: string; itemRank?: number }) =>
      z
        .object({
          repo: z.string(),
          nextSteps: z.array(z.string()).optional(),
          analysisId: z.string().uuid().optional(),
          itemRank: z.number().int().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    // Get GitHub connection
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("github_login, access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");

    const token = conn.access_token;

    // Resolve AI provider (user key → server key → GitHub Models via OAuth token)
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);

    // ── 1. Fetch repo metadata + tree in parallel ──────────────
    const [repoRes, treeData] = await Promise.all([
      ghFetch(token, `/repos/${data.repo}`),
      (async () => {
        // We need the default branch first, so fetch repo then tree
        // But we can at least parallelize the CI check
        return null;
      })(),
    ]);

    if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
    const repo = (await repoRes.json()) as Record<string, unknown>;
    const defaultBranch = repo.default_branch as string;

    // Now fetch tree + CI check + test check in parallel
    const [treeResult, ciResult] = await Promise.all([
      withTimeout(getRepoTree(token, data.repo, defaultBranch), 15000, "File tree fetch"),
      ghFetch(token, `/repos/${data.repo}/contents/.github/workflows`),
    ]);

    const tree = treeResult.tree.filter((t) => t.type === "blob");
    const hasCi = ciResult.ok;
    const hasTests = tree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path));
    const hasLicense = !!repo.license;
    const hasReadme = tree.some((t) => /^readme/i.test(t.path));
    const hasHomepage = !!repo.homepage;

    const repoData = {
      description: (repo.description as string) || null,
      language: (repo.language as string) || null,
      default_branch: defaultBranch,
      topics: (repo.topics as string[]) || [],
      stars: (repo.stargazers_count as number) || 0,
      open_issues: (repo.open_issues_count as number) || 0,
      has_ci: hasCi,
      has_tests: hasTests,
      has_license: hasLicense,
      has_readme: hasReadme,
      has_homepage: hasHomepage,
      file_count: tree.length,
      key_directories: Array.from(
        new Set(tree.map((t) => t.path.split("/")[0]).filter((p) => !p.startsWith("."))),
      ).slice(0, 8),
    };

    // ── 2. Resolve next steps ──────────────────────────────────
    let nextSteps = data.nextSteps || [];
    if (nextSteps.length === 0 && data.analysisId && data.itemRank !== undefined) {
      const { data: item } = await context.supabase
        .from("analysis_items")
        .select("next_steps")
        .eq("analysis_id", data.analysisId)
        .eq("rank", data.itemRank)
        .maybeSingle();
      if (item) nextSteps = (item as Record<string, unknown>).next_steps as string[];
    }

    if (nextSteps.length === 0) {
      // Generate targeted next steps based on actual health check
      nextSteps = [];
      if (!hasReadme)
        nextSteps.push("Add a comprehensive README with installation and usage instructions");
      if (!hasLicense) nextSteps.push("Add a LICENSE file");
      if (!hasCi) nextSteps.push("Set up basic CI/CD");
      if (!hasTests) nextSteps.push("Add basic tests for the main entry point");
      nextSteps.push("Fix any obvious bugs or incomplete implementations");
    }

    // ── 3. Fetch key files in parallel ─────────────────────────
    const files = await withTimeout(
      fetchKeyFiles(token, data.repo, defaultBranch, treeResult),
      20000,
      "Key file fetch",
    );

    if (files.length === 0) {
      throw new Error(
        "Could not fetch any source files from the repo. Check if it's empty or private.",
      );
    }

    // ── 4. Generate the finish plan via AI ─────────────────────
    const plan = await withTimeout(
      generateFinishPlan(data.repo, repoData, files, nextSteps, aiConfig),
      60000,
      "AI plan generation",
    );

    if (!plan.changes || plan.changes.length === 0) {
      throw new Error("AI didn't generate any changes — the repo might already be in good shape.");
    }

    // ── 5. Batch commit all changes via Git Data API ───────────
    // This creates a single commit with all changes instead of N sequential commits
    const branchName = `repo-finisher/fixes-${Date.now().toString(36)}`;

    const commitResult = await withTimeout(
      batchCommit(token, data.repo, defaultBranch, branchName, plan.changes),
      30000,
      "Batch commit",
    );

    // ── 6. Create PR ───────────────────────────────────────────
    const changeLog: FinishResult["changes"] = plan.changes
      .slice(0, commitResult.filesChanged)
      .map((c) => ({
        file: c.path,
        status: c.status as "created" | "modified" | "deleted",
        description: c.description,
      }));

    const prTitle = `🤖 RepoFinisher: ${commitResult.filesChanged} improvement${commitResult.filesChanged > 1 ? "s" : ""}`;
    const prBody = `## Automated improvements by RepoFinisher

${plan.analysis}

### Changes (${commitResult.filesChanged} file${commitResult.filesChanged > 1 ? "s" : ""})

${changeLog.map((c) => `- [${c.status === "created" ? "+" : c.status === "modified" ? "~" : "-"}] \`${c.file}\` — ${c.description}`).join("\n")}

### Next steps addressed

${nextSteps.map((s) => `- [x] ${s}`).join("\n")}

---

*Generated by [RepoFinisher](https://repofinish.vercel.app) — automated codebase completion.*`;

    const pr = await withTimeout(
      (async () => {
        const prRes = await ghFetch(token, `/repos/${data.repo}/pulls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: prTitle,
            head: branchName,
            base: defaultBranch,
            body: prBody,
          }),
        });
        if (!prRes.ok) {
          const err = await prRes.text();
          throw new Error(`Failed to create PR: ${prRes.status} ${err.slice(0, 200)}`);
        }
        return (await prRes.json()) as { number: number; html_url: string };
      })(),
      15000,
      "PR creation",
    );

    const result: FinishResult = {
      repo: data.repo,
      branch: branchName,
      pr_url: pr.html_url,
      pr_number: pr.number,
      files_changed: commitResult.filesChanged,
      additions: 0,
      deletions: 0,
      summary: plan.analysis,
      changes: changeLog,
    };

    // Save the finish result to the analysis item if we have one
    if (data.analysisId && data.itemRank !== undefined) {
      await context.supabase
        .from("analysis_items")
        .update({
          finish_result: result as unknown as import("@/integrations/supabase/types").Json,
        })
        .eq("analysis_id", data.analysisId)
        .eq("rank", data.itemRank);
    }

    return result;
  });

// ─── Get finish status for a repo ──────────────────────────────

export const getFinishStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: items } = await context.supabase
      .from("analysis_items")
      .select("finish_result, title, rank")
      .contains("repos", [data.repo])
      .eq("user_id", context.userId)
      .order("rank", { ascending: true });

    const finished = (items || []).filter((i) => (i as Record<string, unknown>).finish_result);

    return {
      repo: data.repo,
      hasBeenFinished: finished.length > 0,
      finishes: JSON.parse(
        JSON.stringify(finished.map((i) => (i as Record<string, unknown>).finish_result)),
      ) as import("@/integrations/supabase/types").Json[],
    };
  });
