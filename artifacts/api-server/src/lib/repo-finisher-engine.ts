import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callAI } from "./ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";
import { reasonAboutRepositoryPlan, type ReasonedPlanningResult } from "./reasoning-orchestrator";
import { verifyDeploymentSandbox, type SandboxVerificationResult } from "./sandbox-verification";
import { parseModelJsonWithRepair } from "./parse-model-json";

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
  sourceBranch?: string;
  baseSha: string;
  summary: string;
  nextSteps: string[];
  changes: ValidatedFileChange[];
  reasoning?: {
    traceId: string | null;
    version: string;
    promptVersion: string;
    strategyArm: "incumbent" | "challenger";
    specialists: string[];
    confidence: number;
    risks: string[];
    validation: string[];
    stopConditions: string[];
  };
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
  sandbox?: SandboxVerificationResult;
}

interface AIFinishPlan {
  analysis: string;
  changes: AIFileChange[];
}

interface RepoContext {
  token: string;
  defaultBranch: string;
  sourceBranch: string;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: { ...ghHeaders(token), ...(opts?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

async function loadRepoContext(supabase: SupabaseClient, userId: string, repoName: string, sourceBranch?: string): Promise<RepoContext> {
  validateRepoName(repoName);
  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;

  const repoRes = await ghFetch(token, `/repos/${repoName}`);
  if (!repoRes.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repoName}`), { status: 404 });
  const repo = (await repoRes.json()) as Record<string, unknown>;
  const defaultBranch = String(repo.default_branch || "main");
  const resolvedSourceBranch = sourceBranch?.trim() || defaultBranch;
  const head = await getBranchHead(token, repoName, resolvedSourceBranch);
  const tree = await getRepoTree(token, repoName, head.treeSha);

  return {
    token,
    defaultBranch,
    sourceBranch: resolvedSourceBranch,
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
        "Fix verified user-visible blockers before adding speculative features",
        "Make the core user flow complete and error-tolerant",
        "Add or repair automated tests for the core behavior",
        "Make CI, build, and deployment-preview verification pass without weakening acceptance criteria",
        "Close security, configuration, documentation, and production-readiness gaps supported by repository evidence",
      ];
}

const FINISH_PLAN_JSON_SCHEMA = {
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
} as const;

// Mirrors FINISH_PLAN_JSON_SCHEMA above so a plan is validated with the exact
// same shape that was requested from the model, regardless of whether the
// provider actually honored strict json_schema mode.
const finishPlanZodSchema = z.object({
  analysis: z.string(),
  changes: z
    .array(
      z.object({
        path: z.string(),
        status: z.enum(["created", "modified", "deleted"]),
        content: z.string(),
        description: z.string(),
      }),
    )
    .min(1)
    .max(MAX_CHANGES),
});

function validateFinishPlan(value: unknown): AIFinishPlan | null {
  const parsed = finishPlanZodSchema.safeParse(value);
  return parsed.success ? (parsed.data as AIFinishPlan) : null;
}

export async function generateFinishPlan(
  repo: string,
  repoData: RepoContext["repoData"],
  files: { path: string; content: string }[],
  nextSteps: string[],
  aiProvider: string,
  aiKey: string | null,
  reasoning?: ReasonedPlanningResult | null,
): Promise<AIFinishPlan> {
  const fileSummaries = files
    .map((file) => `--- FILE: ${file.path} ---\n${file.content.slice(0, 4000)}`)
    .join("\n\n");

  const system = `You are RepoFinisher's senior coding agent. You receive a repository, inspected source, and an upstream multi-stage diagnosis. Generate the smallest concrete set of file changes that resolves accepted root causes and has the highest probability of passing the stated validation.\n\nBefore writing changes:\n1. Tie each code change to a verified blocker or accepted reasoning step.\n2. Preserve working interfaces unless the evidence proves the interface itself is the blocker.\n3. Consider edge cases, security, backwards compatibility, deployment behavior, and database migration safety.\n4. Prefer fixing root cause over symptoms.\n5. If the upstream reasoning identifies uncertainty, do not invent an API or dependency to fill the gap.\n\nRules:\n- Return complete final contents for created or modified files, not diffs.\n- For deleted files return an empty content string.\n- Never create or modify secrets, private keys, production .env files, credential files, package-manager auth files, or cloud credentials.\n- Never replace, edit, or delete an existing license.\n- Never weaken tests, CI/security controls, permissions, approval gates, or acceptance criteria merely to make a run pass.\n- Never delete workflows, SECURITY.md, or CODEOWNERS.\n- Generated GitHub Actions must not use pull_request_target, write-all permissions, or repository secrets.\n- Do not rewrite entire files unless necessary; preserve working behavior.\n- Add a license only if explicitly requested and the repository has no license.\n- Keep the plan to ${MAX_CHANGES} files or fewer.\n\nReturn JSON with analysis and changes[]. Each change has path, status (created|modified|deleted), content, and description.`;

  const reasoningText = reasoning
    ? `\nReasoning version: ${reasoning.version}\nPrompt strategy: ${reasoning.promptVersion} (${reasoning.strategyArm})\nReasoning confidence: ${reasoning.confidence}/100\nSpecialists: ${reasoning.specialists.join(", ") || "none"}\nReasoning summary: ${reasoning.summary}\nRisks:\n${reasoning.risks.map((risk) => `- ${risk}`).join("\n")}\nValidation expectations:\n${reasoning.validation.map((step) => `- ${step}`).join("\n")}\nStop conditions:\n${reasoning.stopConditions.map((step) => `- ${step}`).join("\n")}\n`
    : "";

  const user = `Repo: ${repo}\nDescription: ${repoData.description || "none"}\nLanguage: ${repoData.language || "unknown"}\nTopics: ${repoData.topics.join(", ") || "none"}\nStars: ${repoData.stars} | Open Issues: ${repoData.open_issues}\nHealth: CI=${repoData.has_ci}, Tests=${repoData.has_tests}, License=${repoData.has_license}, README=${repoData.has_readme}, Homepage=${repoData.has_homepage}\n${reasoningText}\nOrdered completion plan:\n${nextSteps.map((step) => `- ${step}`).join("\n")}\n\nInspected source files:\n${fileSummaries}`;

  const result = await callAI(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "finish_plan", strict: true, schema: FINISH_PLAN_JSON_SCHEMA },
      },
      thinkingLevel: reasoning ? "high" : "medium",
      timeoutMs: 75_000,
    },
    { provider: aiProvider, apiKey: aiKey },
  );

  const parsed = await parseModelJsonWithRepair<AIFinishPlan>(result.content || "", {
    validate: validateFinishPlan,
    // Exactly one bounded repair attempt: re-prompt the same provider/model,
    // showing it its own malformed reply, asking for pure raw JSON only. No
    // eval/Function anywhere in this path — repair output goes through the
    // same tryParseModelJson()+validateFinishPlan() as the first attempt.
    repair: async () => {
      const repairResult = await callAI(
        {
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
            { role: "assistant", content: (result.content || "").slice(0, 4000) },
            {
              role: "user",
              content:
                'Your previous response could not be parsed as JSON matching the required schema. Reply with ONLY the raw JSON object — no markdown code fences, no backticks, no prose before or after it. It must match this exact shape: {"analysis": string, "changes": [{"path": string, "status": "created"|"modified"|"deleted", "content": string, "description": string}]}.',
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "finish_plan_repair", strict: true, schema: FINISH_PLAN_JSON_SCHEMA },
          },
          thinkingLevel: "low",
          timeoutMs: 60_000,
        },
        { provider: aiProvider, apiKey: aiKey },
      );
      return repairResult.content || "";
    },
  });

  if (!parsed.ok) {
    // Sanitized, bounded error — never the full prompt or a raw giant LLM
    // dump — safe to persist as a completion-session's stop_reason/last_error.
    throw new Error(
      `Planning response could not be parsed into a valid finish plan${parsed.repaired ? " after one repair attempt" : ""}: ${parsed.error} (sample: ${JSON.stringify(parsed.rawSample)})`,
    );
  }

  return parsed.value;
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
  data: {
    repo: string;
    nextSteps?: string[];
    analysisId?: string;
    itemRank?: number;
    completionRunId?: string;
    portfolioRunId?: string;
    reasoning?: boolean;
    mode?: "plan" | "replan";
    baseBranch?: string;
  },
) {
  const requestedNextSteps = await resolveNextSteps(supabase, data);
  let reasoning: ReasonedPlanningResult | null = null;
  if (data.reasoning !== false) {
    try {
      reasoning = await reasonAboutRepositoryPlan(supabase, userId, {
        repo: data.repo,
        requestedNextSteps,
        analysisId: data.analysisId,
        itemRank: data.itemRank,
        completionRunId: data.completionRunId,
        portfolioRunId: data.portfolioRunId,
        ref: data.baseBranch,
        mode: data.mode ?? "plan",
      });
    } catch (error) {
      console.warn(`[repo-finisher] deep reasoning failed for ${data.repo}; falling back to evidence-aware direct planning:`, error instanceof Error ? error.message : error);
    }
  }
  const nextSteps = reasoning?.nextSteps?.length ? reasoning.nextSteps : requestedNextSteps;
  const context = await loadRepoContext(supabase, userId, data.repo, data.baseBranch);
  const files = await fetchKeyFiles(context.token, data.repo, context.baseSha, context.tree);
  const aiCredential = await loadAiCredential(supabase, userId, context.token);

  const generated = await generateFinishPlan(
    data.repo,
    context.repoData,
    files,
    nextSteps,
    aiCredential.provider,
    aiCredential.apiKey,
    reasoning,
  );
  const changes = validatePlanChanges(generated.changes, context.tree);

  const plan: PreparedFinishPlan = {
    version: PLAN_VERSION,
    mode: "atomic_plan",
    repo: data.repo,
    defaultBranch: context.defaultBranch,
    sourceBranch: data.baseBranch?.trim() || undefined,
    baseSha: context.baseSha,
    summary: reasoning ? `${reasoning.summary}\n\nCoding plan: ${generated.analysis}` : generated.analysis,
    nextSteps,
    changes,
    reasoning: reasoning
      ? {
          traceId: reasoning.traceId,
          version: reasoning.version,
          promptVersion: reasoning.promptVersion,
          strategyArm: reasoning.strategyArm,
          specialists: reasoning.specialists,
          confidence: reasoning.confidence,
          risks: reasoning.risks,
          validation: reasoning.validation,
          stopConditions: reasoning.stopConditions,
        }
      : undefined,
  };

  return { plan, planHash: hashPreparedPlan(plan), reasoning };
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
  if (plan.sourceBranch) {
    throw Object.assign(new Error("Continuation plans must be executed with executeContinuationPlan so the existing draft PR branch is preserved."), { status: 409 });
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
  const reasoningSection = plan.reasoning
    ? `\n### Reasoning and learning\n\n- Strategy: \`${plan.reasoning.promptVersion}\` (${plan.reasoning.strategyArm})\n- Confidence: ${plan.reasoning.confidence}/100\n- Specialists: ${plan.reasoning.specialists.join(", ") || "none"}\n- Reasoning trace: ${plan.reasoning.traceId || "not persisted"}\n`
    : "";
  const prTitle = `🤖 RepoFinisher: ${changes.length} approved improvement${changes.length === 1 ? "" : "s"}`;
  const prBody = `## Approved RepoFinisher run\n\n${plan.summary}\n\n### Changes (${changes.length})\n\n${changeLog
    .map((change) => `- [${change.status === "created" ? "+" : change.status === "modified" ? "~" : "-"}] \`${change.file}\` — ${change.description}`)
    .join("\n")}${reasoningSection}\n### Approval binding\n\n- Base commit: \`${plan.baseSha}\`\n- Plan hash: \`${expectedPlanHash}\`\n- Generated commit: \`${commit.sha}\`\n\nThis pull request is intentionally **draft**. Required checks and review should pass before merge.\n\n---\n\n*Generated by RepoFinisher.*`;
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

async function updateBranchAtCommit(token: string, repo: string, branch: string, sha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha, force: false }),
  });
  if (!res.ok) throw new Error(`Failed to advance continuation branch: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function executeContinuationPlan(
  supabase: SupabaseClient,
  userId: string,
  plan: PreparedFinishPlan,
  expectedPlanHash: string,
  branchName: string,
  prNumber: number,
  prUrl: string,
): Promise<FinishResult> {
  validateRepoName(plan.repo);
  const actualHash = hashPreparedPlan(plan);
  if (actualHash !== expectedPlanHash) {
    throw Object.assign(new Error("Stored continuation plan no longer matches its approval hash."), { status: 409 });
  }
  if (!plan.sourceBranch || plan.sourceBranch !== branchName) {
    throw Object.assign(new Error("Continuation plan is not bound to the active RepoFinisher branch."), { status: 409 });
  }
  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;
  const current = await getBranchHead(token, plan.repo, branchName);
  if (current.commitSha !== plan.baseSha) {
    throw Object.assign(new Error(`Continuation branch changed after planning. Approved base ${plan.baseSha.slice(0, 12)} is no longer current; re-plan from the new head.`), { status: 409, code: "STALE_BASE" });
  }
  const tree = await getRepoTree(token, plan.repo, current.treeSha);
  const changes = validatePlanChanges(plan.changes, tree);
  const blobs = new Map<string, string>();
  await Promise.all(changes.filter((change) => change.status !== "deleted").map(async (change) => {
    const blob = await createBlob(token, plan.repo, change.content);
    blobs.set(change.path, blob.sha);
  }));
  const treeEntries = changes.map((change) => ({
    path: change.path,
    mode: change.mode,
    type: "blob" as const,
    sha: change.status === "deleted" ? null : blobs.get(change.path) || null,
  }));
  if (treeEntries.some((entry) => entry.sha === null && changes.find((change) => change.path === entry.path)?.status !== "deleted")) {
    throw new Error("Failed to create one or more continuation Git blobs; branch was not changed.");
  }
  const newTree = await createTree(token, plan.repo, current.treeSha, treeEntries);
  const commit = await createCommit(token, plan.repo, `repo-finisher: continue approved plan ${expectedPlanHash.slice(0, 12)}`, newTree.sha, plan.baseSha);
  await updateBranchAtCommit(token, plan.repo, branchName, commit.sha);
  const changeLog = changes.map((change) => ({ file: change.path, status: change.status, description: change.description }));
  return {
    repo: plan.repo,
    branch: branchName,
    pr_url: prUrl,
    pr_number: prNumber,
    files_changed: changes.length,
    additions: 0,
    deletions: 0,
    summary: plan.summary,
    changes: changeLog,
    base_sha: plan.baseSha,
    head_sha: commit.sha,
    plan_hash: expectedPlanHash,
  };
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

  const sandboxPromise = verifyDeploymentSandbox(token, repo, headSha);
  const [checksRes, statusRes, sandbox] = await Promise.all([
    ghFetch(token, `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`),
    ghFetch(token, `/repos/${repo}/commits/${headSha}/status`),
    sandboxPromise,
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

  const sandboxCounted = sandbox.state !== "skipped";
  if (sandbox.state === "failed") failedChecks.push(`deployment-preview-sandbox: ${sandbox.message}`);
  if (sandbox.state === "pending") pendingChecks.push("deployment-preview-sandbox");

  const totalChecks = checks.length + statuses.length + (sandboxCounted ? 1 : 0);
  const completedChecks = totalChecks - pendingChecks.length;
  const uniqueFailed = [...new Set(failedChecks)];
  const uniquePending = [...new Set(pendingChecks)];

  if (uniqueFailed.length > 0) {
    return {
      state: "failed",
      totalChecks,
      completedChecks,
      failedChecks: uniqueFailed,
      pendingChecks: uniquePending,
      message: `${uniqueFailed.length} required verification signal${uniqueFailed.length === 1 ? "" : "s"} failed. ${sandbox.state === "failed" ? sandbox.message : ""}`.trim(),
      sandbox,
    };
  }

  if (totalChecks === 0 || uniquePending.length > 0) {
    return {
      state: "pending",
      totalChecks,
      completedChecks,
      failedChecks: [],
      pendingChecks: uniquePending,
      message:
        totalChecks === 0
          ? "No CI, commit-status, or isolated deployment-preview results are available yet; verification remains pending."
          : sandbox.state === "pending"
            ? `Code checks are not failing; ${sandbox.message}`
            : "Checks are still running.",
      sandbox,
    };
  }

  return {
    state: "passed",
    totalChecks,
    completedChecks,
    failedChecks: [],
    pendingChecks: [],
    message:
      sandbox.state === "passed"
        ? `All reported GitHub checks and commit statuses passed. ${sandbox.message}`
        : "All reported GitHub checks and commit statuses passed. No isolated preview deployment was exposed for additional smoke validation.",
    sandbox,
  };
}
