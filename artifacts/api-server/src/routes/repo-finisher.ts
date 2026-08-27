import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";

const router: IRouter = Router();

const MAX_CHANGES = 25;
const MAX_FILE_BYTES = 750_000;
const MAX_TOTAL_BYTES = 2_000_000;

interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
  mode: string;
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
  changes: { file: string; status: "created" | "modified" | "deleted"; description: string }[];
}

function ghHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "repo-finisher" };
}

async function ghFetch(token: string, path: string, opts?: RequestInit) {
  return fetch(`https://api.github.com${path}`, { ...opts, headers: { ...ghHeaders(token), ...(opts?.headers || {}) } });
}

function encodeRepoPath(path: string) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function getRepoTree(token: string, repo: string, branch: string): Promise<GitHubTreeEntry[]> {
  const res = await ghFetch(token, `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  const json = (await res.json()) as { truncated?: boolean; tree: GitHubTreeEntry[] };
  if (json.truncated) {
    throw new Error("Repository tree is too large for safe autonomous editing. Use a scoped completion run instead.");
  }
  return json.tree.filter((t) => t.type === "blob");
}

async function getFileContent(token: string, repo: string, path: string, ref?: string): Promise<GitHubFile | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await ghFetch(token, `/repos/${repo}/contents/${encodeRepoPath(path)}${query}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; sha: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { path, content, sha: json.sha };
}

async function getBranchHead(token: string, repo: string, branch: string) {
  const refRes = await ghFetch(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!refRes.ok) throw new Error(`Failed to get base branch ref: ${refRes.status}`);
  const ref = (await refRes.json()) as { object: { sha: string } };

  const commitRes = await ghFetch(token, `/repos/${repo}/git/commits/${ref.object.sha}`);
  if (!commitRes.ok) throw new Error(`Failed to get base commit: ${commitRes.status}`);
  const commit = (await commitRes.json()) as { tree: { sha: string } };

  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function createBlob(token: string, repo: string, content: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create blob: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { sha: string };
}

async function createTree(
  token: string,
  repo: string,
  baseTreeSha: string,
  entries: Array<{ path: string; mode: string; type: "blob"; sha: string | null }>,
) {
  const res = await ghFetch(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create tree: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { sha: string };
}

async function createCommit(token: string, repo: string, message: string, treeSha: string, parentSha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create commit: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { sha: string };
}

async function createBranchAtCommit(token: string, repo: string, branch: string, sha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 422) throw new Error(`Branch "${branch}" already exists`);
    throw new Error(`Failed to create branch: ${res.status} ${err.slice(0, 200)}`);
  }
}

async function createPR(token: string, repo: string, head: string, base: string, title: string, body: string) {
  const res = await ghFetch(token, `/repos/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body, draft: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create PR: ${res.status} ${err.slice(0, 200)}`);
  }
  return (await res.json()) as { number: number; html_url: string };
}

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

interface ValidatedFileChange extends AIFileChange {
  status: "created" | "modified" | "deleted";
  mode: "100644" | "100755";
}

function validateRepoName(repo: string) {
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    throw Object.assign(new Error("Invalid GitHub repository name."), { status: 400 });
  }
}

function validateChangePath(path: string) {
  if (!path || path !== path.trim() || path.length > 300 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`Unsafe file path in finish plan: ${JSON.stringify(path)}`);
  }

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.toLowerCase() === ".git")) {
    throw new Error(`Unsafe file path in finish plan: ${path}`);
  }

  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) || "";
  const safeEnvTemplates = new Set([".env.example", ".env.sample", ".env.template", ".env.defaults"]);
  const looksLikeEnvSecret = name === ".env" || (name.startsWith(".env.") && !safeEnvTemplates.has(name));
  const looksLikePrivateKey = /\.(pem|p12|pfx|key)$/.test(name) || /^(id_rsa|id_ed25519|id_ecdsa)$/.test(name);
  const looksLikeCredentialFile = /^(credentials|service[-_]?account|client_secret.*)\.json$/.test(name);

  if (looksLikeEnvSecret || looksLikePrivateKey || looksLikeCredentialFile) {
    throw new Error(`RepoFinisher will not autonomously write credential-bearing path: ${path}`);
  }
}

function validateWorkflowContent(path: string, content: string) {
  if (!/^\.github\/workflows\/.*\.ya?ml$/i.test(path)) return;
  const lower = content.toLowerCase();
  const blocked = ["pull_request_target", "permissions: write-all", "${{ secrets."];
  const match = blocked.find((token) => lower.includes(token));
  if (match) {
    throw new Error(`Generated workflow ${path} contains a privileged construct (${match}) and requires manual review.`);
  }
}

function validatePlanChanges(changes: AIFileChange[], tree: GitHubTreeEntry[]): ValidatedFileChange[] {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error("AI didn't generate any file changes.");
  if (changes.length > MAX_CHANGES) throw new Error(`Finish plan exceeds the ${MAX_CHANGES}-file safety limit.`);

  const existing = new Map(tree.map((entry) => [entry.path, entry]));
  const seen = new Set<string>();
  let totalBytes = 0;

  return changes.map((change) => {
    validateChangePath(change.path);
    if (seen.has(change.path)) throw new Error(`Finish plan contains duplicate path: ${change.path}`);
    seen.add(change.path);

    const current = existing.get(change.path);
    let status = change.status;
    if (status === "deleted" && !current) throw new Error(`Finish plan tried to delete a missing file: ${change.path}`);
    if (status === "created" && current) status = "modified";
    if (status === "modified" && !current) status = "created";

    const lower = change.path.toLowerCase();
    if (current && /(^|\/)(license|license\.md|license\.txt)$/i.test(lower) && status !== "deleted") {
      throw new Error(`Existing license files are protected from autonomous modification: ${change.path}`);
    }
    if (status === "deleted" && (/^\.github\/workflows\//i.test(change.path) || /(^|\/)(security\.md|codeowners)$/i.test(change.path))) {
      throw new Error(`Security and CI governance files are protected from autonomous deletion: ${change.path}`);
    }

    const mode = current?.mode === "100755" ? "100755" : "100644";
    if (current && current.mode !== "100644" && current.mode !== "100755") {
      throw new Error(`RepoFinisher will not modify special Git object ${change.path} (mode ${current.mode}).`);
    }

    if (status !== "deleted") {
      validateWorkflowContent(change.path, change.content);
      const bytes = Buffer.byteLength(change.content, "utf-8");
      if (bytes > MAX_FILE_BYTES) throw new Error(`${change.path} exceeds the ${MAX_FILE_BYTES}-byte autonomous edit limit.`);
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Finish plan exceeds the ${MAX_TOTAL_BYTES}-byte total edit limit.`);
    }

    return { ...change, status, mode };
  });
}

async function atomicCommitPlan(
  token: string,
  repo: string,
  baseBranch: string,
  branchName: string,
  changes: ValidatedFileChange[],
) {
  const base = await getBranchHead(token, repo, baseBranch);

  const blobs = new Map<string, string>();
  await Promise.all(
    changes
      .filter((change) => change.status !== "deleted")
      .map(async (change) => {
        const blob = await createBlob(token, repo, change.content);
        blobs.set(change.path, blob.sha);
      }),
  );

  const treeEntries = changes.map((change) => ({
    path: change.path,
    mode: change.mode,
    type: "blob" as const,
    sha: change.status === "deleted" ? null : blobs.get(change.path) || null,
  }));

  if (treeEntries.some((entry) => entry.sha === null && changes.find((change) => change.path === entry.path)?.status !== "deleted")) {
    throw new Error("Failed to create one or more file blobs; no branch was changed.");
  }

  const tree = await createTree(token, repo, base.treeSha, treeEntries);
  const commit = await createCommit(
    token,
    repo,
    `repo-finisher: apply ${changes.length} approved improvement${changes.length === 1 ? "" : "s"}`,
    tree.sha,
    base.commitSha,
  );
  await createBranchAtCommit(token, repo, branchName, commit.sha);

  return { commitSha: commit.sha, baseSha: base.commitSha };
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
  const fileSummaries = files.map((f) => `--- FILE: ${f.path} ---\n${f.content.slice(0, 3000)}`).join("\n\n");

  const system = `You are RepoFinisher's senior implementation planner. Your objective is to take this repository to production-ready completion within the approved scope — not merely make it "closer to shippable".

Before returning the plan, internally perform a draft-and-challenge loop:
1. Infer the intended product from the repository evidence and recommended completion steps.
2. Draft the smallest coherent implementation that closes the identified blockers.
3. Adversarially review that draft for missed core functionality, broken/stubbed flows, dependency/configuration issues, data/auth/security gaps, UX/accessibility issues, tests, build/typecheck/lint, deployment, observability, documentation, and rollback needs that actually apply.
4. Revise the draft so every change has a clear acceptance criterion and the plan does not claim completion while known blockers remain.
Do not expose private chain-of-thought; return only the concise improved analysis and exact file changes.

Rules:
- Preserve working architecture unless evidence shows it is the blocker.
- Fix actual missing core features and obvious bugs before cosmetic improvements.
- Create or fix README.md with installation, usage, configuration, deployment, and operational notes when needed.
- Add a LICENSE only when explicitly recommended and none exists; never replace an existing license.
- Add unprivileged CI when missing and appropriate.
- Add or repair tests that verify the changed behavior.
- Never create or edit secrets, private keys, production .env files, or credential files.
- Never use pull_request_target, write-all workflow permissions, or repository secrets in generated CI.
- Do not rewrite entire files unnecessarily, but each returned modified/created file must contain its FULL final content.
- For deleted files set content to an empty string.
- Keep this atomic plan to ${MAX_CHANGES} files or fewer. If true completion requires more than this safety limit, make this the highest-leverage coherent completion milestone and state the remaining blockers clearly rather than pretending the repo is complete.

Return JSON with:
- analysis: concise evidence-based summary of the completion blockers, what this plan closes, and any blockers that must remain for a later milestone
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

  const aiResult = await callAI(
    {
      messages: [
        { role: "system", content: system },
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
                maxItems: MAX_CHANGES,
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
    { provider: aiProvider, apiKey: aiKey },
  );
  return JSON.parse(aiResult.content || "{}") as AIFinishPlan;
}

async function fetchKeyFiles(
  token: string,
  repo: string,
  branch: string,
  tree: GitHubTreeEntry[],
): Promise<{ path: string; content: string }[]> {
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

  const srcFiles = tree
    .filter((t) => t.path.startsWith("src/") && /\.(ts|tsx|js|jsx|py|go|rs)$/.test(t.path))
    .slice(0, 10)
    .map((t) => t.path);

  for (const f of srcFiles) {
    if (!keyFiles.includes(f)) keyFiles.push(f);
    if (keyFiles.length >= 20) break;
  }

  const files: { path: string; content: string }[] = [];
  for (const path of keyFiles.slice(0, 15)) {
    const file = await getFileContent(token, repo, path, branch);
    if (file) files.push({ path: file.path, content: file.content });
  }

  return files;
}

export async function finishRepoCore(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  data: { repo: string; nextSteps?: string[]; analysisId?: string; itemRank?: number },
): Promise<FinishResult> {
  validateRepoName(data.repo);

  const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = github.token;

  const repoRes = await ghFetch(token, `/repos/${data.repo}`);
  if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
  const repo = (await repoRes.json()) as Record<string, unknown>;

  const defaultBranch = repo.default_branch as string;
  const repoTree = await getRepoTree(token, data.repo, defaultBranch);
  const repoData = {
    description: (repo.description as string) || null,
    language: (repo.language as string) || null,
    default_branch: defaultBranch,
    topics: (repo.topics as string[]) || [],
    stars: (repo.stargazers_count as number) || 0,
    open_issues: (repo.open_issues_count as number) || 0,
    has_ci: repoTree.some((t) => /^\.github\/workflows\/.*\.ya?ml$/i.test(t.path)),
    has_tests: repoTree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path)),
    has_license: !!repo.license,
    has_readme: repoTree.some((t) => /(^|\/)readme(\.|$)/i.test(t.path)),
    has_homepage: !!repo.homepage,
  };

  let nextSteps = data.nextSteps || [];
  if (nextSteps.length === 0 && data.analysisId && data.itemRank !== undefined) {
    const { data: item } = await supabase
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
      "Set up basic CI/CD",
      "Add basic tests",
      "Fix any obvious bugs or incomplete implementations",
    ];
  }

  const files = await fetchKeyFiles(token, data.repo, defaultBranch, repoTree);

  const aiCredential = await loadAiCredential(supabase, userId, token);
  const plan = await generateFinishPlan(
    data.repo,
    repoData,
    files,
    nextSteps,
    aiCredential.provider,
    aiCredential.apiKey,
  );

  const changes = validatePlanChanges(plan.changes, repoTree);
  const branchName = `repo-finisher/fixes-${Date.now().toString(36)}`;
  const commit = await atomicCommitPlan(token, data.repo, defaultBranch, branchName, changes);

  const changeLog: FinishResult["changes"] = changes.map((change) => ({
    file: change.path,
    status: change.status,
    description: change.description,
  }));
  const filesChanged = changeLog.length;

  const prTitle = `🤖 RepoFinisher: ${filesChanged} improvement${filesChanged > 1 ? "s" : ""}`;
  const prBody = `## Automated improvements by RepoFinisher

${plan.analysis}

### Changes (${filesChanged} file${filesChanged > 1 ? "s" : ""})

${changeLog.map((c) => `- [${c.status === "created" ? "+" : c.status === "modified" ? "~" : "-"}] \`${c.file}\` — ${c.description}`).join("\n")}

### Next steps addressed

${nextSteps.map((s) => `- [x] ${s}`).join("\n")}

### Safety gate

- All planned file changes were committed atomically in a single Git commit.
- Base commit: \`${commit.baseSha}\`
- Generated commit: \`${commit.commitSha}\`
- This pull request is intentionally **draft**. CI and human review should pass before merge.

---

*Generated by RepoFinisher — automated codebase completion.*`;

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

  if (data.analysisId && data.itemRank !== undefined) {
    await supabase
      .from("analysis_items")
      .update({ finish_result: result as unknown as never })
      .eq("analysis_id", data.analysisId)
      .eq("rank", data.itemRank);
  }

  return result;
}

router.post(
  "/repo-finisher/finish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        repo: z.string(),
        nextSteps: z.array(z.string()).optional(),
        analysisId: z.string().uuid().optional(),
        itemRank: z.number().int().optional(),
      })
      .parse(req.body);

    const result = await finishRepoCore(req.supabase!, req.userId!, data);
    res.json(result);
  }),
);

router.get(
  "/repo-finisher/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { repo } = z.object({ repo: z.string() }).parse(req.query);
    validateRepoName(repo);

    const { data: items } = await req.supabase!
      .from("analysis_items")
      .select("finish_result, title, rank")
      .contains("repos", [repo])
      .eq("user_id", req.userId!)
      .order("rank", { ascending: true });

    const finished = (items || []).filter((i) => (i as Record<string, unknown>).finish_result);

    res.json({
      repo,
      hasBeenFinished: finished.length > 0,
      finishes: finished.map((i) => (i as Record<string, unknown>).finish_result),
    });
  }),
);

export default router;