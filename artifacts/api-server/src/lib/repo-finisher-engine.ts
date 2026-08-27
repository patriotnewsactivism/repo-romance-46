import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAI } from "./ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";

const MAX_CHANGES = 25;
const MAX_FILE_BYTES = 750_000;
const MAX_TOTAL_BYTES = 2_000_000;
const PLAN_VERSION = 1 as const;

export interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
  mode: string;
}

export interface AIFileChange {
  path: string;
  status: "created" | "modified" | "deleted";
  content: string;
  description: string;
}

export interface ValidatedFileChange extends AIFileChange {
  mode: "100644" | "100755";
}

export interface PreparedFinishPlan {
  version: typeof PLAN_VERSION;
  mode: "atomic_plan";
  repo: string;
  defaultBranch: string;
  baseSha: string;
  summary: string;
  nextSteps: string[];
  changes: ValidatedFileChange[];
}

export interface FinishResult {
  repo: string;
  branch: string;
  pr_url: string;
  pr_number: number;
  files_changed: number;
  additions: number;
  deletions: number;
  summary: string;
  changes: { file: string; status: "created" | "modified" | "deleted"; description: string }[];
  base_sha: string;
  head_sha: string;
  plan_hash: string;
}

export interface VerificationResult {
  state: "pending" | "passed" | "failed";
  totalChecks: number;
  completedChecks: number;
  failedChecks: string[];
  pendingChecks: string[];
  message: string;
}

interface AIFinishPlan {
  analysis: string;
  changes: AIFileChange[];
}

interface RepoContext {
  token: string;
  defaultBranch: string;
  baseSha: string;
  treeSha: string;
  tree: GitHubTreeEntry[];
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
  };
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(token: string, path: string, opts?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { ...ghHeaders(token), ...(opts?.headers || {}) },
  });
}

function encodeRepoPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function validateRepoName(repo: string) {
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    throw Object.assign(new Error("Invalid GitHub repository name."), { status: 400 });
  }
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

async function getRepoTree(token: string, repo: string, treeSha: string): Promise<GitHubTreeEntry[]> {
  const res = await ghFetch(token, `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  const json = (await res.json()) as { truncated?: boolean; tree: GitHubTreeEntry[] };
  if (json.truncated) {
    throw Object.assign(
      new Error("Repository tree is too large for a safe whole-repo autonomous run. Use a scoped run."),
      { status: 409 },
    );
  }
  return json.tree.filter((entry) => entry.type === "blob");
}

async function getFileContent(token: string, repo: string, path: string, ref: string) {
  const res = await ghFetch(
    token,
    `/repos/${repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

async function loadRepoContext(supabase: SupabaseClient, userId: string, repoName: string): Promise<RepoContext> {
  validateRepoName(repoName);
  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;

  const repoRes = await ghFetch(token, `/repos/${repoName}`);
  if (!repoRes.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repoName}`), { status: 404 });
  const repo = (await repoRes.json()) as Record<string, unknown>;
  const defaultBranch = String(repo.default_branch || "main");
  const head = await getBranchHead(token, repoName, defaultBranch);
  const tree = await getRepoTree(token, repoName, head.treeSha);

  return {
    token,
    defaultBranch,
    baseSha: head.commitSha,
    treeSha: head.treeSha,
    tree,
    repoData: {
      description: typeof repo.description === "string" ? repo.description : null,
      language: typeof repo.language === "string" ? repo.language : null,
      default_branch: defaultBranch,
      topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
      stars: Number(repo.stargazers_count || 0),
      open_issues: Number(repo.open_issues_count || 0),
      has_ci: tree.some((entry) => /^\.github\/workflows\/.*\.ya?ml$/i.test(entry.path)),
      has_tests: tree.some((entry) => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(entry.path)),
      has_license: Boolean(repo.license) || tree.some((entry) => /(^|\/)licen[cs]e(\.|$)/i.test(entry.path)),
      has_readme: tree.some((entry) => /(^|\/)readme(\.|$)/i.test(entry.path)),
      has_homepage: typeof repo.homepage === "string" && repo.homepage.length > 0,
    },
  };
}

function validateChangePath(path: string) {
  if (
    !path ||
    path !== path.trim() ||
    path.length > 300 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
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
  const looksLikePackageCredential = [".npmrc", ".pypirc", ".netrc"].includes(name);
  const looksLikeCloudCredential = lower === ".aws/credentials" || lower.endsWith("/.aws/credentials");

  if (looksLikeEnvSecret || looksLikePrivateKey || looksLikeCredentialFile || looksLikePackageCredential || looksLikeCloudCredential) {
    throw new Error(`RepoFinisher will not autonomously write credential-bearing path: ${path}`);
  }
}

function validateGeneratedContent(path: string, content: string) {
  if (/^\.github\/workflows\/.*\.ya?ml$/i.test(path)) {
    const lower = content.toLowerCase();
    const blocked = ["pull_request_target", "permissions: write-all", "${{ secrets."];
    const match = blocked.find((token) => lower.includes(token));
    if (match) {
      throw new Error(`Generated workflow ${path} contains privileged construct ${JSON.stringify(match)} and requires manual review.`);
    }
  }

  const secretPatterns: Array<[string, RegExp]> = [
    ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
    ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ["Supabase management token", /\bsbp_[A-Za-z0-9]{20,}\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ];
  const detected = secretPatterns.find(([, pattern]) => pattern.test(content));
  if (detected) throw new Error(`Generated content for ${path} appears to contain a ${detected[0]}; autonomous write blocked.`);
}

export function validatePlanChanges(changes: AIFileChange[], tree: GitHubTreeEntry[]): ValidatedFileChange[] {
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

    if (current && /(^|\/)licen[cs]e(?:\.|$)/i.test(change.path)) {
      throw new Error(`Existing license files are protected from autonomous modification or deletion: ${change.path}`);
    }
    if (
      status === "deleted" &&
      (/^\.github\/workflows\//i.test(change.path) || /(^|\/)(security\.md|codeowners)$/i.test(change.path))
    ) {
      throw new Error(`Security and CI governance files are protected from autonomous deletion: ${change.path}`);
    }

    const mode = current?.mode === "100755" ? "100755" : "100644";
    if (current && current.mode !== "100644" && current.mode !== "100755") {
      throw new Error(`RepoFinisher will not modify special Git object ${change.path} (mode ${current.mode}).`);
    }

    if (status !== "deleted") {
      validateGeneratedContent(change.path, change.content);
      const bytes = Buffer.byteLength(change.content, "utf-8");
      if (bytes > MAX_FILE_BYTES) throw new Error(`${change.path} exceeds the ${MAX_FILE_BYTES}-byte autonomous edit limit.`);
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Finish plan exceeds the ${MAX_TOTAL_BYTES}-byte total edit limit.`);
    }

    return { ...change, status, mode };
  });
}

async function fetchKeyFiles(token: string, repo: string, baseSha: string, tree: GitHubTreeEntry[]) {
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

  for (const node of tree.filter((entry) => entry.path.startsWith("src/") && /\.(ts|tsx|js|jsx|py|go|rs)$/.test(entry.path))) {
    if (!keyFiles.includes(node.path)) keyFiles.push(node.path);
    if (keyFiles.length >= 20) break;
  }

  const files: { path: string; content: string }[] = [];
  for (const path of keyFiles.slice(0, 15)) {
    const content = await getFileContent(token, repo, path, baseSha);
    if (content !== null) files.push({ path, content });
  }
  return files;
}

async function resolveNextSteps(
  supabase: SupabaseClient,
  data: { nextSteps?: string[]; analysisId?: string; itemRank?: number },
) {
  let nextSteps = data.nextSteps?.filter((step) => step.trim().length > 0) || [];
  if (nextSteps.length === 0 && data.analysisId && data.itemRank !== undefined) {
    const { data: item, error } = await supabase
      .from("analysis_items")
      .select("next_steps")
      .eq("analysis_id", data.analysisId)
      .eq("rank", data.itemRank)
      .maybeSingle();
    if (error) throw new Error(`Failed to load analysis item: ${error.message}`);
    if (item && Array.isArray((item as Record<string, unknown>).next_steps)) {
      nextSteps = ((item as Record<string, unknown>).next_steps as unknown[]).map(String);
    }
  }

  return nextSteps.length > 0
    ? nextSteps
    : [
        "Add a comprehensive README with installation and usage instructions",
        "Set up basic CI/CD",
        "Add basic tests",
        "Fix obvious bugs or incomplete implementations that are supported by the inspected source",
      ];
}

async function generateFinishPlan(
  repo: string,
  repoData: RepoContext["repoData"],
  files: { path: string; content: string }[],
  nextSteps: string[],
  aiProvider: string,
  aiKey: string | null,
): Promise<AIFinishPlan> {
  const fileSummaries = files
    .map((file) => `--- FILE: ${file.path} ---\n${file.content.slice(0, 3000)}`)
    .join("\n\n");

  const system = `You are a senior software engineer finishing an incomplete codebase.
Generate the smallest concrete set of file changes that directly addresses verified gaps in the inspected repository.

Before writing changes:
1. Identify the specific blocking or incomplete behavior visible in the provided source and health data.
2. Consider edge cases, security risk, backwards compatibility, and whether a change is actually supported by evidence.
3. Form a minimal execution plan. Do not add speculative features just to make the change list longer.

Rules:
- Return complete final contents for created or modified files, not diffs.
- For deleted files return an empty content string.
- Never create or modify secrets, private keys, production .env files, credential files, package-manager auth files, or cloud credentials.
- Never replace, edit, or delete an existing license.
- Never weaken CI/security controls or delete workflows, SECURITY.md, or CODEOWNERS.
- Generated GitHub Actions must not use pull_request_target, write-all permissions, or repository secrets.
- Do not rewrite entire files unless necessary; preserve working interfaces and behavior.
- Add a license only if the recommended next steps explicitly request one and the repository has no license.
- Keep the plan to ${MAX_CHANGES} files or fewer.

Return JSON with analysis and changes[]. Each change has path, status (created|modified|deleted), content, and description.`;

  const user = `Repo: ${repo}
Description: ${repoData.description || "none"}
Language: ${repoData.language || "unknown"}
Topics: ${repoData.topics.join(", ") || "none"}
Stars: ${repoData.stars} | Open Issues: ${repoData.open_issues}
Health: CI=${repoData.has_ci}, Tests=${repoData.has_tests}, License=${repoData.has_license}, README=${repoData.has_readme}, Homepage=${repoData.has_homepage}

Recommended next steps:
${nextSteps.map((step) => `- ${step}`).join("\n")}

Inspected source files:
${fileSummaries}`;

  const result = await callAI(
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
                minItems: 1,
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

  return JSON.parse(result.content || "{}") as AIFinishPlan;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function hashPreparedPlan(plan: PreparedFinishPlan) {
  return createHash("sha256").update(canonicalize(plan)).digest("hex");
}

export async function prepareFinishPlan(
  supabase: SupabaseClient,
  userId: string,
  data: { repo: string; nextSteps?: string[]; analysisId?: string; itemRank?: number },
) {
  const context = await loadRepoContext(supabase, userId, data.repo);
  const nextSteps = await resolveNextSteps(supabase, data);
  const files = await fetchKeyFiles(context.token, data.repo, context.baseSha, context.tree);

  const aiCredential = await loadAiCredential(supabase, userId, context.token);

  const generated = await generateFinishPlan(
    data.repo,
    context.repoData,
    files,
    nextSteps,
    aiCredential.provider,
    aiCredential.apiKey,
  );
  const changes = validatePlanChanges(generated.changes, context.tree);

  const plan: PreparedFinishPlan = {
    version: PLAN_VERSION,
    mode: "atomic_plan",
    repo: data.repo,
    defaultBranch: context.defaultBranch,
    baseSha: context.baseSha,
    summary: generated.analysis,
    nextSteps,
    changes,
  };

  return { plan, planHash: hashPreparedPlan(plan) };
}

async function createBlob(token: string, repo: string, content: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  if (!res.ok) throw new Error(`Failed to create Git blob: ${res.status} ${(await res.text()).slice(0, 200)}`);
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
  if (!res.ok) throw new Error(`Failed to create Git tree: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { sha: string };
}

async function createCommit(token: string, repo: string, message: string, treeSha: string, parentSha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) throw new Error(`Failed to create Git commit: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { sha: string };
}

async function createBranchAtCommit(token: string, repo: string, branch: string, sha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422) throw Object.assign(new Error(`Branch ${branch} already exists.`), { status: 409 });
    throw new Error(`Failed to create branch: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function createDraftPR(token: string, repo: string, head: string, base: string, title: string, body: string) {
  const res = await ghFetch(token, `/repos/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body, draft: true }),
  });
  if (!res.ok) throw new Error(`Failed to create pull request: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { number: number; html_url: string };
}

export async function executePreparedPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: PreparedFinishPlan,
  expectedPlanHash: string,
) {
  validateRepoName(plan.repo);
  const actualHash = hashPreparedPlan(plan);
  if (actualHash !== expectedPlanHash) {
    throw Object.assign(new Error("Stored completion plan no longer matches its approval hash."), { status: 409 });
  }

  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;
  const current = await getBranchHead(token, plan.repo, plan.defaultBranch);
  if (current.commitSha !== plan.baseSha) {
    throw Object.assign(
      new Error(`Repository changed after preview. Approved base ${plan.baseSha.slice(0, 12)} is no longer current; re-plan before execution.`),
      { status: 409, code: "STALE_BASE" },
    );
  }

  const tree = await getRepoTree(token, plan.repo, current.treeSha);
  const changes = validatePlanChanges(plan.changes, tree);

  const blobs = new Map<string, string>();
  await Promise.all(
    changes
      .filter((change) => change.status !== "deleted")
      .map(async (change) => {
        const blob = await createBlob(token, plan.repo, change.content);
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
    throw new Error("Failed to create one or more Git blobs; no branch was changed.");
  }

  const newTree = await createTree(token, plan.repo, current.treeSha, treeEntries);
  const commit = await createCommit(
    token,
    plan.repo,
    `repo-finisher: apply approved plan ${expectedPlanHash.slice(0, 12)}`,
    newTree.sha,
    plan.baseSha,
  );
  const branchName = `repo-finisher/run-${Date.now().toString(36)}-${expectedPlanHash.slice(0, 8)}`;
  await createBranchAtCommit(token, plan.repo, branchName, commit.sha);

  const changeLog = changes.map((change) => ({
    file: change.path,
    status: change.status,
    description: change.description,
  }));
  const prTitle = `🤖 RepoFinisher: ${changes.length} approved improvement${changes.length === 1 ? "" : "s"}`;
  const prBody = `## Approved RepoFinisher run\n\n${plan.summary}\n\n### Changes (${changes.length})\n\n${changeLog
    .map((change) => `- [${change.status === "created" ? "+" : change.status === "modified" ? "~" : "-"}] \`${change.file}\` — ${change.description}`)
    .join("\n")}\n\n### Approval binding\n\n- Base commit: \`${plan.baseSha}\`\n- Plan hash: \`${expectedPlanHash}\`\n- Generated commit: \`${commit.sha}\`\n\nThis pull request is intentionally **draft**. Required checks and review should pass before merge.\n\n---\n\n*Generated by RepoFinisher.*`;
  const pr = await createDraftPR(token, plan.repo, branchName, plan.defaultBranch, prTitle, prBody);

  const result: FinishResult = {
    repo: plan.repo,
    branch: branchName,
    pr_url: pr.html_url,
    pr_number: pr.number,
    files_changed: changes.length,
    additions: 0,
    deletions: 0,
    summary: plan.summary,
    changes: changeLog,
    base_sha: plan.baseSha,
    head_sha: commit.sha,
    plan_hash: expectedPlanHash,
  };

  return result;
}

export async function verifyCommitChecks(
  supabase: SupabaseClient,
  userId: string,
  repo: string,
  headSha: string,
): Promise<VerificationResult> {
  validateRepoName(repo);
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw Object.assign(new Error("Invalid commit SHA."), { status: 400 });
  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;

  const [checksRes, statusRes] = await Promise.all([
    ghFetch(token, `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`),
    ghFetch(token, `/repos/${repo}/commits/${headSha}/status`),
  ]);

  const checks = checksRes.ok
    ? ((await checksRes.json()) as { check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }).check_runs || []
    : [];
  const statuses = statusRes.ok
    ? ((await statusRes.json()) as { statuses?: Array<{ context: string; state: string }> }).statuses || []
    : [];

  const failedConclusions = new Set(["failure", "timed_out", "cancelled", "action_required", "stale", "startup_failure"]);
  const failedChecks = [
    ...checks.filter((check) => check.conclusion && failedConclusions.has(check.conclusion)).map((check) => check.name),
    ...statuses.filter((status) => status.state === "failure" || status.state === "error").map((status) => status.context),
  ];
  const pendingChecks = [
    ...checks.filter((check) => check.status !== "completed").map((check) => check.name),
    ...statuses.filter((status) => status.state === "pending").map((status) => status.context),
  ];
  const totalChecks = checks.length + statuses.length;
  const completedChecks = totalChecks - pendingChecks.length;

  if (failedChecks.length > 0) {
    return {
      state: "failed",
      totalChecks,
      completedChecks,
      failedChecks: [...new Set(failedChecks)],
      pendingChecks: [...new Set(pendingChecks)],
      message: `${failedChecks.length} required check signal${failedChecks.length === 1 ? "" : "s"} failed.`,
    };
  }

  if (totalChecks === 0 || pendingChecks.length > 0) {
    return {
      state: "pending",
      totalChecks,
      completedChecks,
      failedChecks: [],
      pendingChecks: [...new Set(pendingChecks)],
      message: totalChecks === 0 ? "No check results are available yet; verification remains pending." : "Checks are still running.",
    };
  }

  return {
    state: "passed",
    totalChecks,
    completedChecks,
    failedChecks: [],
    pendingChecks: [],
    message: "All reported GitHub checks and commit statuses passed.",
  };
}
