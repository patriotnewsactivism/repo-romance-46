import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/ai-provider";

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
  const json = (await res.json()) as { tree: Array<{ path: string; type: string; sha: string }> };
  return json.tree.filter((t) => t.type === "blob");
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

async function createBranch(token: string, repo: string, baseBranch: string, newBranch: string) {
  // Get the SHA of the base branch
  const refRes = await ghFetch(token, `/repos/${repo}/git/refs/heads/${baseBranch}`);
  if (!refRes.ok) throw new Error(`Failed to get base branch ref: ${refRes.status}`);
  const ref = (await refRes.json()) as { object: { sha: string } };

  // Create the new branch
  const createRes = await ghFetch(token, `/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    if (createRes.status === 422) throw new Error(`Branch "${newBranch}" already exists`);
    throw new Error(`Failed to create branch: ${createRes.status} ${err}`);
  }
}

async function commitFile(
  token: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
) {
  const res = await ghFetch(token, `/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to commit ${path}: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { commit: { sha: string } };
}

async function createPR(
  token: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
) {
  const res = await ghFetch(token, `/repos/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create PR: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { number: number; html_url: string };
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
  },
  files: { path: string; content: string }[],
  nextSteps: string[],
  aiProvider: string,
  aiKey: string | null,
): Promise<AIFinishPlan> {
  const fileSummaries = files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content.slice(0, 3000)}`)
    .join("\n\n");

  const system = `You are an expert software engineer that finishes incomplete codebases.
Given a repo's metadata, health check, key source files, and a list of recommended next steps,
generate concrete file changes that will move this repo closer to "shippable".

Rules:
- Create or fix README.md with proper installation, usage, and API docs
- Add a LICENSE file (MIT) if missing
- Add .github/workflows/ci.yml with basic CI if missing
- Fix obvious bugs, add missing exports, complete stub functions
- Add basic tests if missing (in the repo's language convention)
- Do NOT rewrite entire files — only make targeted improvements
- Each file change must include the FULL file content (not a diff)
- For "modified" files, output the complete updated file
- For "created" files, output the full new file
- For "deleted" files, set content to empty string

Return JSON with:
- analysis: brief summary of what was wrong and what you fixed (3-5 sentences)
- changes: array of { path, status, content, description }`;

  const user = `Repo: ${repo}
Description: ${repoData.description || "none"}
Language: ${repoData.language || "unknown"}
Topics: ${repoData.topics.join(", ") || "none"}
Stars: ${repoData.stars} | Open Issues: ${repoData.open_issues}
Health: CI=${repoData.has_ci}, Tests=${repoData.has_tests}, License=${repoData.has_license}, README=${repoData.has_readme}, Homepage=${repoData.has_homepage}

Recommended next steps:
${nextSteps.map((s) => `- ${s}`).join("\n")}

Current source files (top ${files.length}):
${fileSummaries}`;

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema" as const,
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
  };

  const aiResult = await callAI(
    {
      messages: body.messages,
      responseFormat: body.response_format,
    },
    { provider: aiProvider, apiKey: aiKey },
  );
  const plan = JSON.parse(aiResult.content || "{}") as AIFinishPlan;
  return plan;
}

// ─── Fetch key files from repo ─────────────────────────────────

async function fetchKeyFiles(
  token: string,
  repo: string,
  branch: string,
): Promise<{ path: string; content: string }[]> {
  const tree = await getRepoTree(token, repo, branch);

  // Prioritize: README, package.json, entry points, config files, source files
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
    /\/__tests__\//,
    /\.test\.[tj]sx?$/,
    /\.spec\.[tj]sx?$/,
    /test_.*\.py$/,
  ];

  const keyFiles: string[] = [];
  for (const pattern of priorityPatterns) {
    for (const node of tree) {
      if (pattern.test(node.path) && !keyFiles.includes(node.path)) {
        keyFiles.push(node.path);
        if (keyFiles.length >= 15) break;
      }
    }
    if (keyFiles.length >= 15) break;
  }

  // Also grab a few source files from src/
  const srcFiles = tree
    .filter((t) => t.path.startsWith("src/") && /\.(ts|tsx|js|jsx|py|go|rs)$/.test(t.path))
    .slice(0, 10)
    .map((t) => t.path);

  for (const f of srcFiles) {
    if (!keyFiles.includes(f)) keyFiles.push(f);
    if (keyFiles.length >= 20) break;
  }

  // Fetch contents (limit to 15 to stay within token budget)
  const files: { path: string; content: string }[] = [];
  for (const path of keyFiles.slice(0, 15)) {
    const file = await getFileContent(token, repo, path);
    if (file) files.push({ path: file.path, content: file.content });
  }

  return files;
}

// ─── Main: Finish a repo ───────────────────────────────────────

export const finishRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
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

    // Get user preferences for AI provider
    const { data: prefs } = await context.supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", context.userId)
      .maybeSingle();

    // Fetch repo metadata
    const repoRes = await ghFetch(token, `/repos/${data.repo}`);
    if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
    const repo = (await repoRes.json()) as Record<string, unknown>;

    const defaultBranch = repo.default_branch as string;
    const repoData = {
      description: (repo.description as string) || null,
      language: (repo.language as string) || null,
      default_branch: defaultBranch,
      topics: (repo.topics as string[]) || [],
      stars: (repo.stargazers_count as number) || 0,
      open_issues: (repo.open_issues_count as number) || 0,
      has_ci: false,
      has_tests: false,
      has_license: !!repo.license,
      has_readme: !!(repo.description as string),
      has_homepage: !!repo.homepage,
    };

    // Check CI
    try {
      const wfRes = await ghFetch(token, `/repos/${data.repo}/contents/.github/workflows`);
      if (wfRes.ok) repoData.has_ci = true;
    } catch {
      /* ignore */
    }

    // Check tests
    try {
      const tree = await getRepoTree(token, data.repo, defaultBranch);
      repoData.has_tests = tree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path));
    } catch {
      /* ignore */
    }

    // If nextSteps not provided directly, try to find them from the analysis item
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
      nextSteps = [
        "Add a comprehensive README with installation and usage instructions",
        "Add a LICENSE file",
        "Set up basic CI/CD",
        "Add basic tests",
        "Fix any obvious bugs or incomplete implementations",
      ];
    }

    // Fetch key source files
    const files = await fetchKeyFiles(token, data.repo, defaultBranch);

    // Generate the finish plan via AI
    // For GitHub Models, fall back to GitHub connection token
    let rfAiKey = prefs?.custom_ai_key || null;
    if (prefs?.custom_ai_provider === "github_models" && !rfAiKey) {
      rfAiKey = token; // reuse the GitHub token we already have
    }
    const plan = await generateFinishPlan(
      data.repo,
      repoData,
      files,
      nextSteps,
      prefs?.custom_ai_provider || "openai",
      rfAiKey,
    );

    if (!plan.changes || plan.changes.length === 0) {
      throw new Error("AI didn't generate any changes — the repo might already be in good shape.");
    }

    // Create a branch
    const branchName = `repo-finisher/fixes-${Date.now().toString(36)}`;
    await createBranch(token, data.repo, defaultBranch, branchName);

    // Commit each file change
    let filesChanged = 0;
    const changeLog: FinishResult["changes"] = [];

    for (const change of plan.changes) {
      if (change.status === "deleted") {
        // Get file SHA first
        const existing = await getFileContent(token, data.repo, change.path);
        if (existing) {
          const delRes = await ghFetch(token, `/repos/${data.repo}/contents/${change.path}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `repo-finisher: delete ${change.path} — ${change.description}`,
              sha: existing.sha,
              branch: branchName,
            }),
          });
          if (delRes.ok) {
            filesChanged++;
            changeLog.push({
              file: change.path,
              status: "deleted",
              description: change.description,
            });
          }
        }
      } else {
        try {
          await commitFile(
            token,
            data.repo,
            branchName,
            change.path,
            change.content,
            `repo-finisher: ${change.status} ${change.path} — ${change.description}`,
          );
          filesChanged++;
          changeLog.push({
            file: change.path,
            status: change.status as "created" | "modified",
            description: change.description,
          });
        } catch (e) {
          // Skip files that fail (e.g., too large)
          console.error(`Failed to commit ${change.path}:`, e);
        }
      }
    }

    if (filesChanged === 0) {
      throw new Error("All file commits failed — check repo permissions.");
    }

    // Create PR
    const prTitle = `🤖 RepoFinisher: ${filesChanged} improvement${filesChanged > 1 ? "s" : ""}`;
    const prBody = `## Automated improvements by RepoFinisher

${plan.analysis}

### Changes (${filesChanged} file${filesChanged > 1 ? "s" : ""})

${changeLog.map((c) => `- [${c.status === "created" ? "+" : c.status === "modified" ? "~" : "-"}] \`${c.file}\` — ${c.description}`).join("\n")}

### Next steps addressed

${nextSteps.map((s) => `- [x] ${s}`).join("\n")}

---

*Generated by [RepoFinisher](https://repofinish.vercel.app) — automated codebase completion.*`;

    const pr = await createPR(token, data.repo, branchName, defaultBranch, prTitle, prBody);

    const result: FinishResult = {
      repo: data.repo,
      branch: branchName,
      pr_url: pr.html_url,
      pr_number: pr.number,
      files_changed: filesChanged,
      additions: 0,
      deletions: 0,
      summary: plan.analysis,
      changes: changeLog,
    };

    // Save the finish result to the analysis item if we have one
    if (data.analysisId && data.itemRank !== undefined) {
      await context.supabase
        .from("analysis_items")
        .update({ finish_result: result })
        .eq("analysis_id", data.analysisId)
        .eq("rank", data.itemRank);
    }

    return result;
  });

// ─── Get finish status for a repo ──────────────────────────────

export const getFinishStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
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
      finishes: finished.map((i) => (i as Record<string, unknown>).finish_result),
    };
  });
