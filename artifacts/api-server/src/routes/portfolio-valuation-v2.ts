import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  buildPortfolioValuation,
  type PortfolioValuationRepoInput,
} from "@workspace/repo-os";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function moneyRange(value: unknown) {
  const row = record(value);
  return {
    low: Math.max(0, Math.round(number(row.low))),
    high: Math.max(0, Math.round(number(row.high))),
  };
}

function activityScore(lastPush: unknown) {
  const timestamp = typeof lastPush === "string" ? new Date(lastPush).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return 20;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 7) return 100;
  if (days <= 30) return 90;
  if (days <= 90) return 75;
  if (days <= 180) return 58;
  if (days <= 365) return 40;
  if (days <= 730) return 22;
  return 10;
}

function inputFromRanking(item: Record<string, unknown>): PortfolioValuationRepoInput | null {
  const repo = text(item.repo);
  if (!repo) return null;
  const details = record(item.details);
  const github = record(details.github);
  const completion = record(details.completion);
  const signals = record(completion.signals);
  const readiness = record(details.readiness);
  const market = record(details.market);

  return {
    repo,
    kind: text(details.kind),
    title: text(details.title),
    description: text(details.pitch),
    language: text(github.language),
    topics: stringArray(github.topics),
    presentValueUsd: moneyRange(item.presentValueUsd),
    potentialValueUsd: moneyRange(item.potentialValueUsd),
    completionPct: number(item.completionPct, number(completion.overall)),
    productionReadinessPct: number(item.productionReadinessPct, number(readiness.overall)),
    commercializationProbability: number(item.commercializationProbability),
    evidenceConfidence: number(item.evidenceConfidence, number(market.confidence)),
    demandScore: number(item.demand, number(market.demand_score)),
    marketNeedScore: number(item.marketNeed, number(market.market_need_score)),
    stars: number(github.stars),
    forks: number(github.forks),
    subscribers: number(github.subscribers),
    openIssues: number(github.openIssues),
    activityScore: activityScore(github.lastPush),
    sourceFiles: number(github.sourceFiles),
    sourceBytes: number(github.sourceBytes),
    hasReadme: Boolean(signals.hasReadme),
    hasLicense: Boolean(signals.hasLicense),
    hasCi: Boolean(signals.hasCi),
    hasTests: Boolean(signals.hasTests),
    hasDeploy: Boolean(signals.hasDeploy),
    hasHomepage: Boolean(signals.hasHomepage),
    // The fast full-portfolio pass intentionally does not claim verified
    // commercial competition. A future external-research pass can populate
    // this only when it has source-backed competition evidence.
    competitivePressureVerified: null,
  };
}

async function calculate(req: Parameters<typeof requireAuth>[0] extends never ? never : any, analysisId: string) {
  const { data, error } = await req.supabase!
    .from("analyses")
    .select("investment_intelligence")
    .eq("id", analysisId)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (error) throw new Error(`Failed to load portfolio intelligence: ${error.message}`);
  if (!data) throw Object.assign(new Error("Analysis not found"), { status: 404 });

  const intelligence = record((data as Record<string, unknown>).investment_intelligence);
  const ranking = Array.isArray(intelligence.ranking)
    ? (intelligence.ranking as Record<string, unknown>[])
    : [];
  if (ranking.length === 0) {
    throw Object.assign(
      new Error("Run Full Portfolio Value first so RepoFinisher has repository-level valuation evidence to confidence-adjust."),
      { status: 409 },
    );
  }

  const inputs = ranking
    .map((item) => inputFromRanking(record(item)))
    .filter((item): item is PortfolioValuationRepoInput => item !== null);
  return buildPortfolioValuation(inputs);
}

router.get(
  "/portfolio-valuation-v2/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json(await calculate(req, id));
  }),
);

router.post(
  "/portfolio-valuation-v2/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const valuationV2 = await calculate(req, id);
    const { data, error } = await req.supabase!
      .from("analyses")
      .select("investment_intelligence")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(`Failed to reload portfolio intelligence: ${error.message}`);
    const intelligence = record((data as Record<string, unknown> | null)?.investment_intelligence);
    const updated = {
      ...intelligence,
      valuationV2,
      valuationV2UpdatedAt: new Date().toISOString(),
    };
    const { error: updateError } = await req.supabase!
      .from("analyses")
      .update({ investment_intelligence: updated, investment_intelligence_updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", req.userId!);
    if (updateError) throw new Error(`Failed to save Portfolio Valuation V2: ${updateError.message}`);
    res.json(valuationV2);
  }),
);

export default router;
