import { createHash } from "node:crypto";
import { runInBackground } from "./background-tasks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAI } from "./ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";
import { loadOperationalMemory, memoryGuidance, recordOperationalMemory } from "./learning-memory";
import { IMMUTABLE_AGENT_SAFETY_POLICY } from "./prompt-strategy-evolution";
import {
  validatePlanChanges,
  validateRepoName,
  type AIFileChange,
  type GitHubTreeEntry,
  type ValidatedFileChange,
  type VerificationResult,
} from "./repo-finisher-engine";

const MAX_REPAIR_CHANGES = 12;
const MAX_EVIDENCE_CHARS = 60_000;
const MAX_CONTEXT_FILES = 18;
const MAX_CONTEXT_FILE_CHARS = 80_000;
const CI_REPAIR_PROMPT_VERSION = "ci-repair-v2-reasoned-learning";

export interface SelfHealingRun {
  id: string;
  user_id?: string;
  repo: string;
  plan: { changes?: Array<{ path?: string }>; reasoning?: unknown } & Record<string, unknown>;
  status: string;
  branch_name: string | null;
  head_sha: string | null;
  auto_repair_enabled?: boolean;
  repair_attempts?: number;
  max_repair_attempts?: number;
  last_repair_error?: string | null;
}

interface RepairEvidence {
  failedChecks: string[];
  checkOutputs: Array<{ name: string; title: string | null; summary: string | null; text: string | null }>;
  failedJobs: Array<{ runId: number; jobId: number; name: string; conclusion: string | null; log: string }>;
}

interface RepairDiagnosis {
  rootCause: string;
  confidence: number;
  evidence: string[];
  rejectedCauses: string[];
  repairStrategy: string[];
  regressionRisks: string[];
  stopIf: string[];
}

interface RepairPlan {
  version: 1;
  mode: "ci_repair";
  repo: string;
  branch: string;
  sourceHeadSha: string;
  promptVersion: string;
  analysis: string;
  diagnosis: RepairDiagnosis;
  failedChecks: string[];
  changes: ValidatedFileChange[];
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher-ci-repair",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(token: string, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { ...ghHeaders(token), ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function redactLog(text: string) {
  return text
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_SECRET]")
    .replace(/\bsbp_[A-Za-z0-9]{20,}\b/g, "[REDACTED_SUPABASE_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

function tail(text: string, maxChars: number) {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

async function collectFailureEvidence(token: string, repo: string, headSha: string, failedChecks: string[]): Promise<RepairEvidence> {
  const checkOutputs: RepairEvidence["checkOutputs"] = [];
  const checkRes = await ghFetch(token, `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`);
  if (checkRes.ok) {
    const json = (await checkRes.json()) as {
      check_runs?: Array<{
        name: string;
        conclusion: string | null;
        output?: { title?: string | null; summary?: string | null; text?: string | null };
      }>;
    };
    for (const check of json.check_runs ?? []) {
      if (!check.conclusion || !["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(check.conclusion)) continue;
      checkOutputs.push({
        name: check.name,
        title: check.output?.title ?? null,
        summary: check.output?.summary ? tail(redactLog(check.output.summary), 8_000) : null,
        text: check.output?.text ? tail(redactLog(check.output.text), 12_000) : null,
      });
    }
  }

  const failedJobs: RepairEvidence["failedJobs"] = [];
  const runsRes = await ghFetch(token, `/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=10`);
  if (runsRes.ok) {
    const runsJson = (await runsRes.json()) as { workflow_runs?: Array<{ id: number; conclusion: string | null }> };
    for (const run of (runsJson.workflow_runs ?? []).slice(0, 5)) {
      const jobsRes = await ghFetch(token, `/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
      if (!jobsRes.ok) continue;
      const jobsJson = (await jobsRes.json()) as { jobs?: Array<{ id: number; name: string; conclusion: string | null }> };
      const failed = (jobsJson.jobs ?? []).filter((job) => job.conclusion && job.conclusion !== "success" && job.conclusion !== "neutral" && job.conclusion !== "skipped");
      for (const job of failed.slice(0, 5)) {
        let log = "";
        const logRes = await ghFetch(token, `/repos/${repo}/actions/jobs/${job.id}/logs`, { headers: { Accept: "text/plain" } });
        if (logRes.ok) log = tail(redactLog(await logRes.text()), 20_000);
        failedJobs.push({ runId: run.id, jobId: job.id, name: job.name, conclusion: job.conclusion, log });
      }
    }
  }

  let used = 0;
  for (const job of failedJobs) {
    if (used >= MAX_EVIDENCE_CHARS) {
      job.log = "";
      continue;
    }
    const remaining = MAX_EVIDENCE_CHARS - used;
    job.log = tail(job.log, remaining);
    used += job.log.length;
  }

  return { failedChecks: [...new Set(failedChecks)], checkOutputs, failedJobs };
}

async function getBranchHead(token: string, repo: string, branch: string) {
  const refRes = await ghFetch(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!refRes.ok) throw new Error(`Unable to read repair branch ${branch}: ${refRes.status}`);
  const ref = (await refRes.json()) as { object: { sha: string } };
  const commitRes = await ghFetch(token, `/repos/${repo}/git/commits/${ref.object.sha}`);
  if (!commitRes.ok) throw new Error(`Unable to read repair branch commit: ${commitRes.status}`);
  const commit = (await commitRes.json()) as { tree: { sha: string } };
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function getTree(token: string, repo: string, treeSha: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (!res.ok) throw new Error(`Unable to read repair tree: ${res.status}`);
  const json = (await res.json()) as { truncated?: boolean; tree?: GitHubTreeEntry[] };
  if (json.truncated) throw new Error("Repository tree is too large for safe automatic CI repair.");
  return (json.tree ?? []).filter((entry) => entry.type === "blob");
}

async function getFile(token: string, repo: string, path: string, ref: string) {
  const res = await ghFetch(token, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || !json.content) return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

function contextCandidates(tree: GitHubTreeEntry[], originalPlan: SelfHealingRun["plan"], evidence: RepairEvidence) {
  const existing = new Set(tree.map((entry) => entry.path));
  const candidates: string[] = [];
  const failureText = JSON.stringify(evidence).toLowerCase();
  const add = (path: string | undefined) => {
    if (!path || !existing.has(path) || candidates.includes(path)) return;
    candidates.push(path);
  };
  for (const change of originalPlan.changes ?? []) add(change.path);
  for (const entry of tree) {
    const basename = entry.path.toLowerCase().split("/").at(-1) || "";
    if (basename.length >= 5 && failureText.includes(basename)) add(entry.path);
    if (candidates.length >= MAX_CONTEXT_FILES) return candidates;
  }
  const priority = [
    /^package\.json$/,
    /^tsconfig.*\.json$/,
    /^(vite|next|vitest|jest|eslint)\.config\./,
    /^pyproject\.toml$/,
    /^requirements.*\.txt$/,
    /^cargo\.toml$/i,
    /^go\.mod$/,
    /^(src|app|server|api|lib)\/(index|main|app|server|route)/,
  ];
  for (const pattern of priority) {
    for (const entry of tree) {
      if (pattern.test(entry.path)) add(entry.path);
      if (candidates.length >= MAX_CONTEXT_FILES) return candidates;
    }
  }
  for (const entry of tree) {
    if (/^(src|app|server|api|lib)\//.test(entry.path) && /\.(ts|tsx|js|jsx|py|go|rs)$/.test(entry.path)) add(entry.path);
    if (candidates.length >= MAX_CONTEXT_FILES) break;
  }
  return candidates.slice(0, MAX_CONTEXT_FILES);
}

function protectedRepairPath(path: string) {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) || "";
  return (
    /^\.github\/workflows\//.test(lower) ||
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(lower) ||
    /\.(test|spec)\.[^.]+$/.test(lower) ||
    /(^|\/)(security\.md|codeowners)$/.test(lower) ||
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|cargo\.lock|go\.sum)$/.test(lower) ||
    name === ".npmrc" ||
    name === ".pypirc"
  );
}

function assertRepairSafety(changes: ValidatedFileChange[], before: Map<string, string>) {
  for (const change of changes) {
    if (change.status === "deleted") throw new Error(`Automatic CI repair cannot delete files: ${change.path}`);
    if (protectedRepairPath(change.path)) throw new Error(`Automatic CI repair cannot modify tests, CI/security governance, or lockfiles: ${change.path}`);
    if (change.path.toLowerCase() === "package.json") {
      const previous = before.get(change.path);
      if (!previous) continue;
      try {
        const oldPackage = JSON.parse(previous) as { scripts?: Record<string, string> };
        const newPackage = JSON.parse(change.content) as { scripts?: Record<string, string> };
        for (const script of ["test", "typecheck", "lint"]) {
          if (oldPackage.scripts?.[script] && oldPackage.scripts[script] !== newPackage.scripts?.[script]) {
            throw new Error(`Automatic CI repair cannot change the existing package.json ${script} script.`);
          }
        }
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error("Automatic CI repair produced invalid package.json JSON.");
        throw error;
      }
    }
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function hashPlan(plan: RepairPlan) {
  return createHash("sha256").update(canonicalize(plan)).digest("hex");
}

function changesFingerprint(changes: Array<{ path: string; status: string; content?: string }>) {
  return createHash("sha256").update(canonicalize(changes.map((change) => ({ path: change.path, status: change.status, content: change.content ?? "" })))).digest("hex");
}

async function diagnoseFailure(
  ai: { provider: string; apiKey: string | null },
  input: Record<string, unknown>,
): Promise<RepairDiagnosis> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's CI failure diagnostician. Determine the most likely root cause before any patch is generated. Separate evidence from guesses, reject attractive-but-unsupported causes, and identify regression risk.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nNever solve a failure by weakening validation. Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "ci_failure_diagnosis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            rootCause: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 100 },
            evidence: { type: "array", maxItems: 12, items: { type: "string" } },
            rejectedCauses: { type: "array", maxItems: 10, items: { type: "string" } },
            repairStrategy: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
            regressionRisks: { type: "array", maxItems: 10, items: { type: "string" } },
            stopIf: { type: "array", maxItems: 8, items: { type: "string" } },
          },
          required: ["rootCause", "confidence", "evidence", "rejectedCauses", "repairStrategy", "regressionRisks", "stopIf"],
        },
      },
    },
    thinkingLevel: "high",
    timeoutMs: 60_000,
  }, ai);
  return JSON.parse(result.content || "{}") as RepairDiagnosis;
}

async function prepareRepairPlan(
  supabase: SupabaseClient,
  userId: string,
  run: SelfHealingRun,
  evidence: RepairEvidence,
  attempt: number,
) {
  if (!run.branch_name || !run.head_sha) throw new Error("CI repair requires an existing RepoFinisher branch and head commit.");
  validateRepoName(run.repo);
  const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const head = await getBranchHead(github.token, run.repo, run.branch_name);
  if (head.commitSha !== run.head_sha) {
    throw new Error(`Repair branch moved from ${run.head_sha.slice(0, 12)} to ${head.commitSha.slice(0, 12)}; refusing to repair stale evidence.`);
  }
  const tree = await getTree(github.token, run.repo, head.treeSha);
  const paths = contextCandidates(tree, run.plan, evidence);
  const files: Array<{ path: string; content: string }> = [];
  const before = new Map<string, string>();
  for (const path of paths) {
    const content = await getFile(github.token, run.repo, path, run.head_sha);
    if (content === null) continue;
    const bounded = content.slice(0, MAX_CONTEXT_FILE_CHARS);
    files.push({ path, content: bounded });
    before.set(path, content);
  }

  const [aiCredential, memoriesResult, previousAttempts] = await Promise.all([
    loadAiCredential(supabase, userId, github.token),
    loadOperationalMemory(supabase, userId, run.repo, ["ci_repair", "failure_mode", "tooling", "deployment"], 20),
    supabase
      .from("completion_repair_attempts")
      .select("attempt, status, plan, error, failed_checks")
      .eq("run_id", run.id)
      .eq("user_id", userId)
      .order("attempt", { ascending: true }),
  ]);
  if (!aiCredential.apiKey) throw new Error(`No usable ${aiCredential.provider} credential is configured for CI repair.`);
  const memory = memoryGuidance(memoriesResult, 12);
  const prior = previousAttempts.data ?? [];
  const ai = { provider: aiCredential.provider, apiKey: aiCredential.apiKey };
  const diagnosisInput = {
    repository: run.repo,
    branch: run.branch_name,
    headSha: run.head_sha,
    repairAttempt: attempt,
    originalPlan: run.plan,
    failedChecks: evidence.failedChecks,
    checkOutputs: evidence.checkOutputs,
    failedJobs: evidence.failedJobs,
    currentFiles: files,
    operationalMemory: memory,
    previousRepairAttempts: prior,
  };
  const diagnosis = await diagnoseFailure(ai, diagnosisInput);
  if (diagnosis.confidence < 25) {
    throw new Error(`CI repair diagnosis confidence is only ${diagnosis.confidence}/100; refusing to guess at a write.`);
  }

  const system = `You are RepoFinisher's bounded CI repair coding agent. A separate diagnostician already analyzed the failure. Implement the smallest patch that addresses the accepted root cause and nothing else.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nNON-NEGOTIABLE REPAIR RULES:\n- Never weaken, remove, skip, mute, or rewrite tests.\n- Never modify GitHub Actions workflows, CODEOWNERS, SECURITY.md, lockfiles, credential files, or secrets.\n- Never delete files.\n- Never change existing package.json test, lint, or typecheck scripts.\n- Fix product/source/build configuration rather than changing acceptance criteria.\n- Use only supplied repository files, CI evidence, measured operational memory, and the diagnosis. Do not invent APIs or dependencies.\n- Do not repeat a prior failed repair unchanged.\n- Keep the patch minimal and directly tied to the root cause.\n- Return strict JSON only.`;

  const result = await callAI(
    {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({ ...diagnosisInput, diagnosis }),
        },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "ci_repair_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              analysis: { type: "string" },
              changes: {
                type: "array",
                minItems: 1,
                maxItems: MAX_REPAIR_CHANGES,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string" },
                    status: { type: "string", enum: ["created", "modified"] },
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
      thinkingLevel: "high",
      timeoutMs: 60_000,
    },
    ai,
  );
  const generated = JSON.parse(result.content || "{}") as { analysis?: string; changes?: AIFileChange[] };
  const changes = validatePlanChanges(generated.changes ?? [], tree);
  assertRepairSafety(changes, before);

  const fingerprint = changesFingerprint(changes);
  for (const previous of prior) {
    const previousPlan = (previous as Record<string, unknown>).plan as Record<string, unknown> | null;
    const previousChanges = Array.isArray(previousPlan?.changes) ? previousPlan!.changes as Array<{ path: string; status: string; content?: string }> : [];
    if (previousChanges.length && changesFingerprint(previousChanges) === fingerprint) {
      throw new Error("The proposed repair is identical to a previous attempt. Re-diagnosis must produce a materially different root-cause fix.");
    }
  }

  const plan: RepairPlan = {
    version: 1,
    mode: "ci_repair",
    repo: run.repo,
    branch: run.branch_name,
    sourceHeadSha: run.head_sha,
    promptVersion: CI_REPAIR_PROMPT_VERSION,
    analysis: generated.analysis || diagnosis.rootCause,
    diagnosis,
    failedChecks: evidence.failedChecks,
    changes,
  };
  return { plan, planHash: hashPlan(plan), token: github.token, treeSha: head.treeSha, memory };
}

async function createBlob(token: string, repo: string, content: string) {
  const res = await ghFetch(token, `/repos/${repo}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  if (!res.ok) throw new Error(`Failed to create repair blob: ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as { sha: string };
}

async function applyRepairPlan(token: string, plan: RepairPlan, treeSha: string, planHash: string) {
  const blobs = new Map<string, string>();
  await Promise.all(plan.changes.map(async (change) => {
    const blob = await createBlob(token, plan.repo, change.content);
    blobs.set(change.path, blob.sha);
  }));
  const treeRes = await ghFetch(token, `/repos/${plan.repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_tree: treeSha,
      tree: plan.changes.map((change) => ({ path: change.path, mode: change.mode, type: "blob", sha: blobs.get(change.path) })),
    }),
  });
  if (!treeRes.ok) throw new Error(`Failed to create repair tree: ${treeRes.status} ${(await treeRes.text()).slice(0, 160)}`);
  const newTree = (await treeRes.json()) as { sha: string };
  const commitRes = await ghFetch(token, `/repos/${plan.repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `repo-finisher: CI self-heal ${planHash.slice(0, 12)}`,
      tree: newTree.sha,
      parents: [plan.sourceHeadSha],
    }),
  });
  if (!commitRes.ok) throw new Error(`Failed to create repair commit: ${commitRes.status} ${(await commitRes.text()).slice(0, 160)}`);
  const commit = (await commitRes.json()) as { sha: string };
  const refRes = await ghFetch(token, `/repos/${plan.repo}/git/refs/heads/${encodeURIComponent(plan.branch)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (!refRes.ok) throw new Error(`Failed to advance repair branch: ${refRes.status} ${(await refRes.text()).slice(0, 160)}`);
  return commit.sha;
}

async function recordEvent(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  kind: string,
  status: "info" | "success" | "warning" | "error",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("completion_events").insert({ run_id: runId, user_id: userId, kind, status, message, metadata });
  if (error) throw new Error(`Failed to record CI repair event: ${error.message}`);
}

async function performRepair(
  supabase: SupabaseClient,
  userId: string,
  run: SelfHealingRun,
  verification: VerificationResult,
  attempt: number,
) {
  try {
    const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
    const evidence = await collectFailureEvidence(github.token, run.repo, run.head_sha!, verification.failedChecks);
    const prepared = await prepareRepairPlan(supabase, userId, run, evidence, attempt);
    const { error: attemptUpdateError } = await supabase
      .from("completion_repair_attempts")
      .update({ plan_hash: prepared.planHash, plan: prepared.plan, evidence: { ...evidence, operationalMemory: prepared.memory } })
      .eq("run_id", run.id)
      .eq("user_id", userId)
      .eq("attempt", attempt);
    if (attemptUpdateError) throw new Error(`Failed to persist repair plan: ${attemptUpdateError.message}`);

    await supabase.from("reasoning_traces").insert({
      user_id: userId,
      repo: run.repo,
      completion_run_id: run.id,
      mode: "repair",
      stage: "repair_plan_ready",
      status: "running",
      prompt_version: CI_REPAIR_PROMPT_VERSION,
      evidence,
      hypotheses: [prepared.plan.diagnosis],
      decision: { planHash: prepared.planHash, analysis: prepared.plan.analysis, changes: prepared.plan.changes.map((change) => ({ path: change.path, status: change.status, description: change.description })) },
      confidence: prepared.plan.diagnosis.confidence,
    });

    const repairedHead = await applyRepairPlan(prepared.token, prepared.plan, prepared.treeSha, prepared.planHash);
    const now = new Date().toISOString();
    const { error: runError } = await supabase
      .from("completion_runs")
      .update({
        status: "verifying",
        head_sha: repairedHead,
        ci_status: "pending",
        error: null,
        last_repair_error: null,
        repairing_at: null,
        updated_at: now,
      })
      .eq("id", run.id)
      .eq("user_id", userId)
      .eq("status", "repairing")
      .eq("repair_attempts", attempt);
    if (runError) throw new Error(`Failed to persist repaired head: ${runError.message}`);

    await Promise.all([
      supabase
        .from("completion_steps")
        .update({ status: "verifying", error: null, completed_at: null, updated_at: now })
        .eq("run_id", run.id)
        .eq("user_id", userId),
      supabase
        .from("completion_repair_attempts")
        .update({ status: "applied", repaired_head_sha: repairedHead, completed_at: now })
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("attempt", attempt),
      supabase
        .from("reasoning_traces")
        .update({ stage: "repair_applied", status: "succeeded", completed_at: now, updated_at: now })
        .eq("completion_run_id", run.id)
        .eq("user_id", userId)
        .eq("mode", "repair")
        .eq("stage", "repair_plan_ready"),
    ]);

    await recordOperationalMemory(supabase, userId, {
      repo: run.repo,
      category: "ci_repair",
      memoryKey: `root-cause:${prepared.plan.diagnosis.rootCause.slice(0, 120)}`,
      observation: `CI repair attempt ${attempt} diagnosed: ${prepared.plan.diagnosis.rootCause}`,
      recommendation: `For matching CI evidence, investigate this root cause before broad changes: ${prepared.plan.diagnosis.repairStrategy.join("; ")}`,
      outcome: "observation",
      confidence: prepared.plan.diagnosis.confidence,
      evidence: [{ failedChecks: verification.failedChecks, planHash: prepared.planHash, repairedHead, at: now }],
    });

    await recordEvent(
      supabase,
      userId,
      run.id,
      "ci_repair_applied",
      "success",
      `Self-healing CI repair attempt ${attempt} applied ${prepared.plan.changes.length} bounded change${prepared.plan.changes.length === 1 ? "" : "s"} after root-cause diagnosis; checks will run again.`,
      { attempt, planHash: prepared.planHash, sourceHeadSha: run.head_sha, repairedHeadSha: repairedHead, failedChecks: verification.failedChecks, diagnosis: prepared.plan.diagnosis },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    const maxAttempts = Number(run.max_repair_attempts ?? 3);
    const exhausted = attempt >= maxAttempts;
    await Promise.all([
      supabase
        .from("completion_repair_attempts")
        .update({ status: "failed", error: message, completed_at: now })
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("attempt", attempt),
      supabase
        .from("completion_runs")
        .update({
          status: exhausted ? "failed" : "verifying",
          ci_status: exhausted ? "failed" : "pending",
          error: exhausted ? `CI self-healing exhausted after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${message}` : null,
          last_repair_error: message,
          repairing_at: null,
          updated_at: now,
        })
        .eq("id", run.id)
        .eq("user_id", userId)
        .eq("status", "repairing")
        .eq("repair_attempts", attempt),
    ]);
    await recordOperationalMemory(supabase, userId, {
      repo: run.repo,
      category: "failure_mode",
      memoryKey: `ci-repair-failure:${verification.failedChecks.join("|").slice(0, 160)}`,
      observation: `CI repair attempt ${attempt} failed: ${message}`,
      recommendation: "Do not repeat the same repair unchanged. Re-read current logs and branch state, test a different root-cause hypothesis, and stop rather than weaken validation if evidence remains insufficient.",
      outcome: "failure",
      confidence: 80,
      evidence: [{ failedChecks: verification.failedChecks, attempt, error: message, at: now }],
    }).catch(() => undefined);
    await recordEvent(
      supabase,
      userId,
      run.id,
      "ci_repair_failed",
      exhausted ? "error" : "warning",
      exhausted ? `CI self-healing exhausted: ${message}` : `CI repair attempt ${attempt} could not be applied; another evidence-driven attempt remains.`,
      { attempt, exhausted, error: message, failedChecks: verification.failedChecks },
    ).catch(() => undefined);
  }
}

export async function tryScheduleCiRepair(
  supabase: SupabaseClient,
  userId: string,
  run: SelfHealingRun,
  verification: VerificationResult,
) {
  if (verification.state !== "failed") return false;
  if (!run.auto_repair_enabled || !run.branch_name || !run.head_sha) return false;
  const currentAttempts = Number(run.repair_attempts ?? 0);
  const maxAttempts = Number(run.max_repair_attempts ?? 3);
  if (currentAttempts >= maxAttempts) return false;

  const attempt = currentAttempts + 1;
  const now = new Date().toISOString();
  const { data: claimed, error } = await supabase
    .from("completion_runs")
    .update({
      status: "repairing",
      repair_attempts: attempt,
      repairing_at: now,
      ci_status: "repairing",
      error: null,
      updated_at: now,
    })
    .eq("id", run.id)
    .eq("user_id", userId)
    .eq("status", "verifying")
    .eq("repair_attempts", currentAttempts)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to claim CI repair attempt: ${error.message}`);
  if (!claimed) return true;

  const { error: attemptError } = await supabase.from("completion_repair_attempts").insert({
    run_id: run.id,
    user_id: userId,
    attempt,
    status: "planning",
    source_head_sha: run.head_sha,
    failed_checks: verification.failedChecks,
    created_at: now,
  });
  if (attemptError) {
    await supabase
      .from("completion_runs")
      .update({ status: "verifying", repair_attempts: currentAttempts, repairing_at: null, ci_status: "failed", updated_at: now })
      .eq("id", run.id)
      .eq("user_id", userId)
      .eq("status", "repairing");
    throw new Error(`Failed to persist CI repair attempt: ${attemptError.message}`);
  }

  await recordEvent(
    supabase,
    userId,
    run.id,
    "ci_repair_started",
    "info",
    `CI failed; starting evidence-driven self-healing repair attempt ${attempt}/${maxAttempts}.`,
    { attempt, maxAttempts, failedChecks: verification.failedChecks, sourceHeadSha: run.head_sha, promptVersion: CI_REPAIR_PROMPT_VERSION },
  );

  const job = performRepair(supabase, userId, { ...run, repair_attempts: attempt }, verification, attempt);
  try {
    runInBackground(job);
  } catch {
    void job.catch(() => undefined);
  }
  return true;
}

export async function markLatestRepairVerified(supabase: SupabaseClient, userId: string, runId: string) {
  const { data } = await supabase
    .from("completion_repair_attempts")
    .select("id, attempt, plan, repaired_head_sha")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("status", "applied")
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return;
  const now = new Date().toISOString();
  await supabase
    .from("completion_repair_attempts")
    .update({ status: "verified", completed_at: now })
    .eq("id", (data as { id: string }).id)
    .eq("user_id", userId);

  const { data: run } = await supabase
    .from("completion_runs")
    .select("repo")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  const repo = run ? String((run as Record<string, unknown>).repo || "") : "";
  const plan = (data as Record<string, unknown>).plan as Record<string, unknown> | null;
  const diagnosis = plan?.diagnosis as RepairDiagnosis | undefined;
  if (repo && diagnosis) {
    await recordOperationalMemory(supabase, userId, {
      repo,
      category: "ci_repair",
      memoryKey: `root-cause:${diagnosis.rootCause.slice(0, 120)}`,
      observation: `The diagnosed CI root cause was verified by passing checks after repair attempt ${String((data as Record<string, unknown>).attempt)}.` ,
      recommendation: `Prefer this repair pattern when future failure evidence matches: ${diagnosis.repairStrategy.join("; ")}`,
      outcome: "success",
      confidence: Math.max(85, diagnosis.confidence),
      evidence: [{ runId, repairedHeadSha: (data as Record<string, unknown>).repaired_head_sha ?? null, verifiedAt: now }],
    }).catch(() => undefined);
  }
}
