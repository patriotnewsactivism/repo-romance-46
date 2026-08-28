import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { buildPortfolioRelationships, type PortfolioGraphRepo } from "../lib/portfolio-graph";

const router: IRouter = Router();

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-portfolio-graph",
  };
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token), signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAccessibleRepoMetadata(token: string, wanted: Set<string>) {
  const byName = new Map<string, Record<string, unknown>>();
  for (let page = 1; page <= 5 && byName.size < wanted.size; page += 1) {
    const rows = await ghJson<Array<Record<string, unknown>>>(token, `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
    if (!rows.length) break;
    for (const row of rows) {
      const fullName = String(row.full_name || "");
      if (wanted.has(fullName)) byName.set(fullName, row);
    }
    if (rows.length < 100) break;
  }
  return byName;
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
    const wanted = new Set(ranked.map((row) => String(row.repo)));
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const metadata = await loadAccessibleRepoMetadata(github.token, wanted);

    const repos: PortfolioGraphRepo[] = ranked.map((row) => {
      const name = String(row.repo);
      const gh = metadata.get(name) ?? {};
      return {
        repo: name,
        description: typeof gh.description === "string" ? gh.description : null,
        language: typeof gh.language === "string" ? gh.language : null,
        topics: Array.isArray(gh.topics) ? gh.topics.map(String) : [],
        archived: Boolean(gh.archived),
        completionPct: Number(row.completionPct ?? 0),
        productionReadinessPct: Number(row.productionReadinessPct ?? 0),
      };
    });

    const relationships = buildPortfolioRelationships(repos, body.maxRelationships);
    const now = new Date().toISOString();
    const { error: deleteError } = await req.supabase!
      .from("portfolio_relationships")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw new Error(`Failed to refresh portfolio relationship graph: ${deleteError.message}`);

    if (relationships.length) {
      const { error: insertError } = await req.supabase!
        .from("portfolio_relationships")
        .insert(relationships.map((relationship) => ({
          user_id: userId,
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
      evidence: { reposCompared: repos.length, metadataMatched: metadata.size },
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
      note: "Relationship signals are evidence-ranked heuristics. High-impact merge/archive actions still require repository-level verification before execution.",
    });
  }),
);

router.get(
  "/repo-finisher/portfolio-graph",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({ repo: z.string().optional(), minConfidence: z.coerce.number().min(0).max(100).default(50) }).parse(req.query);
    let request = req.supabase!
      .from("portfolio_relationships")
      .select("*")
      .eq("user_id", req.userId!)
      .gte("confidence", query.minConfidence)
      .order("confidence", { ascending: false })
      .limit(500);
    if (query.repo) request = request.or(`repo_a.eq.${query.repo},repo_b.eq.${query.repo}`);
    const { data, error } = await request;
    if (error) throw new Error(`Failed to load portfolio relationship graph: ${error.message}`);
    res.json(data ?? []);
  }),
);

export default router;
