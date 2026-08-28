import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { buildPortfolioRelationships, type PortfolioGraphRepo } from "../lib/portfolio-graph";

const router: IRouter = Router();
const repoSchema = z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/);

function ghHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-portfolio-graph",
  };
}

async function ghFetch(token: string, path: string, accept?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token, accept), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const response = await ghFetch(token, path);
  if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
  return await response.json() as T;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function loadAccessibleRepoMetadata(token: string, wanted: string[]) {
  const byName = new Map<string, Record<string, unknown>>();
  let cursor = 0;
  const workers = Math.min(12, wanted.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < wanted.length) {
      const repo = wanted[cursor++];
      try {
        const row = await ghJson<Record<string, unknown>>(token, `/repos/${repo}`);
        byName.set(repo, row);
      } catch {
        // Relationship scoring can still use saved analysis data for an inaccessible repo.
      }
    }
  }));
  return byName;
}

function parseDependencies(text: string | null, path: string) {
  if (!text) return [];
  try {
    if (path === "package.json") {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const groups = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
      return groups.flatMap((group) => {
        const value = parsed[group];
        return value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : [];
      });
    }
    if (/requirements.*\.txt$/i.test(path)) {
      return text.split(/\r?\n/).map((line) => line.trim().split(/[<>=!~\s[]/)[0]).filter(Boolean);
    }
    if (path === "pyproject.toml") {
      return [...text.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["'{[]/gm)].map((match) => match[1]);
    }
  } catch {
    return [];
  }
  return [];
}

async function loadGraphSignals(token: string, repo: string, defaultBranch: string) {
  try {
    const branch = await ghJson<{ commit?: { sha?: string } }>(token, `/repos/${repo}/branches/${encodeURIComponent(defaultBranch)}`);
    const headSha = String(branch.commit?.sha || "");
    if (!headSha) return { dependencies: [] as string[], fileFingerprints: [] as string[] };
    const tree = await ghJson<{ tree?: Array<{ path: string; type: string; size?: number }> }>(token, `/repos/${repo}/git/trees/${headSha}?recursive=1`);
    const paths = (tree.tree ?? []).filter((entry) => entry.type === "blob").map((entry) => entry.path);
    const manifests = ["package.json", "pyproject.toml", "requirements.txt"]
      .filter((path) => paths.includes(path));
    const dependencies: string[] = [];
    for (const path of manifests.slice(0, 2)) {
      const response = await ghFetch(token, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(headSha)}`);
      if (!response.ok) continue;
      const json = await response.json() as { content?: string; encoding?: string };
      if (!json.content || json.encoding !== "base64") continue;
      dependencies.push(...parseDependencies(Buffer.from(json.content, "base64").toString("utf-8"), path));
    }
    const importantPaths = paths
      .filter((path) => /(^|\/)(package\.json|pyproject\.toml|readme[^/]*|.*config.*|src\/.*\.(ts|tsx|js|jsx|py|go|rs))$/i.test(path))
      .sort()
      .slice(0, 120);
    const pathBands = importantPaths.map((path) => path.toLowerCase().replace(/\d+/g, "#"));
    const fileFingerprints = pathBands.map((path) => createHash("sha1").update(path).digest("hex").slice(0, 12));
    return {
      dependencies: [...new Set(dependencies.map((value) => value.toLowerCase()))].slice(0, 250),
      fileFingerprints,
    };
  } catch {
    return { dependencies: [] as string[], fileFingerprints: [] as string[] };
  }
}

router.post(
  "/repo-finisher/portfolio-graph/:analysisId/rebuild",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { analysisId } = z.object({ analysisId: z.string().uuid() }).parse(req.params);
    const body = z.object({ maxRelationships: z.number().int().min(10).max(500).default(250) }).parse(req.body ?? {});
    const userId = req.userId!;
    const { data: analysis, error } = await req.supabase!
      .from("analyses")
      .select("investment_intelligence")
      .eq("id", analysisId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load portfolio analysis: ${error.message}`);
    if (!analysis) throw Object.assign(new Error("Analysis not found."), { status: 404 });

    const intelligence = (analysis as Record<string, unknown>).investment_intelligence;
    const ranking = intelligence && typeof intelligence === "object"
      ? (intelligence as Record<string, unknown>).ranking
      : null;
    if (!Array.isArray(ranking) || ranking.length < 2) {
      throw Object.assign(new Error("Full Portfolio Value must be calculated before building the portfolio relationship graph."), { status: 409 });
    }

    const ranked = ranking
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && typeof (row as Record<string, unknown>).repo === "string"))
      .slice(0, 500);
    const names = ranked.map((row) => String(row.repo));
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const metadata = await loadAccessibleRepoMetadata(github.token, names);

    const signalByRepo = new Map<string, { dependencies: string[]; fileFingerprints: string[] }>();
    let signalCursor = 0;
    const signalWorkers = Math.min(8, names.length);
    await Promise.all(Array.from({ length: signalWorkers }, async () => {
      while (signalCursor < names.length) {
        const name = names[signalCursor++];
        const gh = metadata.get(name);
        const defaultBranch = typeof gh?.default_branch === "string" ? gh.default_branch : "main";
        signalByRepo.set(name, await loadGraphSignals(github.token, name, defaultBranch));
      }
    }));

    const repos: PortfolioGraphRepo[] = ranked.map((row) => {
      const name = String(row.repo);
      const gh = metadata.get(name) ?? {};
      const signals = signalByRepo.get(name) ?? { dependencies: [], fileFingerprints: [] };
      return {
        repo: name,
        description: typeof gh.description === "string" ? gh.description : null,
        language: typeof gh.language === "string" ? gh.language : null,
        topics: Array.isArray(gh.topics) ? gh.topics.map(String) : [],
        archived: Boolean(gh.archived),
        completionPct: Number(row.completionPct ?? 0),
        productionReadinessPct: Number(row.productionReadinessPct ?? 0),
        dependencies: signals.dependencies,
        fileFingerprints: signals.fileFingerprints,
      };
    });

    const relationships = buildPortfolioRelationships(repos, body.maxRelationships);
    const now = new Date().toISOString();
    const { error: deleteError } = await req.supabase!
      .from("portfolio_relationships")
      .delete()
      .eq("user_id", userId)
      .eq("analysis_id", analysisId);
    if (deleteError) throw new Error(`Failed to refresh portfolio relationship graph: ${deleteError.message}`);

    if (relationships.length) {
      const { error: insertError } = await req.supabase!
        .from("portfolio_relationships")
        .insert(relationships.map((relationship) => ({
          user_id: userId,
          analysis_id: analysisId,
          repo_a: relationship.repoA,
          repo_b: relationship.repoB,
          relationship_type: relationship.type,
          confidence: relationship.confidence,
          evidence: relationship.evidence,
          recommendation: relationship.recommendation,
          generated_at: now,
          updated_at: now,
        })));
      if (insertError) throw new Error(`Failed to persist portfolio relationship graph: ${insertError.message}`);
    }

    await req.supabase!.from("reasoning_traces").insert({
      user_id: userId,
      repo: "*portfolio*",
      analysis_id: analysisId,
      mode: "portfolio_graph",
      stage: "complete",
      status: "succeeded",
      evidence: { reposCompared: repos.length, metadataMatched: metadata.size, graphSignalsCollected: signalByRepo.size },
      hypotheses: relationships.slice(0, 50),
      decision: {
        relationshipCount: relationships.length,
        duplicateCount: relationships.filter((item) => item.type === "duplicate").length,
        mergeCandidateCount: relationships.filter((item) => item.type === "merge_candidate").length,
        archiveCandidateCount: relationships.filter((item) => item.type === "archive_candidate").length,
      },
      confidence: relationships.length ? Math.round(relationships.reduce((sum, item) => sum + item.confidence, 0) / relationships.length) : 0,
      completed_at: now,
    });

    res.json({
      analysisId,
      reposCompared: repos.length,
      relationships,
      generatedAt: now,
      note: "Relationship signals are evidence-ranked heuristics using repository metadata plus dependency and structural fingerprints. High-impact merge/archive actions still require repository-level verification before execution.",
    });
  }),
);

router.get(
  "/repo-finisher/portfolio-graph",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({
      repo: repoSchema.optional(),
      analysisId: z.string().uuid().optional(),
      minConfidence: z.coerce.number().min(0).max(100).default(50),
    }).parse(req.query);

    const makeRequest = () => {
      let request = req.supabase!
        .from("portfolio_relationships")
        .select("*")
        .eq("user_id", req.userId!)
        .gte("confidence", query.minConfidence)
        .order("confidence", { ascending: false })
        .limit(500);
      if (query.analysisId) request = request.eq("analysis_id", query.analysisId);
      return request;
    };

    if (!query.repo) {
      const { data, error } = await makeRequest();
      if (error) throw new Error(`Failed to load portfolio relationship graph: ${error.message}`);
      res.json(data ?? []);
      return;
    }

    const [left, right] = await Promise.all([
      makeRequest().eq("repo_a", query.repo),
      makeRequest().eq("repo_b", query.repo),
    ]);
    if (left.error || right.error) {
      throw new Error(`Failed to load portfolio relationship graph: ${left.error?.message ?? right.error?.message ?? "unknown database error"}`);
    }
    const merged = new Map<string, Record<string, unknown>>();
    for (const row of [...(left.data ?? []), ...(right.data ?? [])]) {
      const record = row as Record<string, unknown>;
      merged.set(String(record.id), record);
    }
    res.json([...merged.values()].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 500));
  }),
);

export default router;
