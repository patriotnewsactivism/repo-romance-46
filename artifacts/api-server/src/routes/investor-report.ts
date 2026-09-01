import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  buildPortfolioValuation,
  type PortfolioValuationRepoInput,
} from "@workspace/repo-os";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { createSimplePdf, type PdfBlock } from "../lib/simple-pdf";

const router: IRouter = Router();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return array(value).map(String).filter(Boolean);
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function money(value: number) {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function range(value: { low: number; high: number }) {
  return `${money(value.low)} - ${money(value.high)}`;
}

function moneyRange(value: unknown) {
  const row = record(value);
  return { low: Math.max(0, Math.round(number(row.low))), high: Math.max(0, Math.round(number(row.high))) };
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

function valuationInput(item: Record<string, unknown>): PortfolioValuationRepoInput | null {
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
    topics: strings(github.topics),
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
    competitivePressureVerified: null,
  };
}

function phaseBlocks(portfolioStats: Record<string, unknown>): PdfBlock[] {
  const plan = record(portfolioStats.action_plan);
  const phases = array(plan.phases).map(record);
  if (phases.length === 0) return [];
  const blocks: PdfBlock[] = [{ kind: "heading", text: "Execution Roadmap" }];
  const totalWeeks = number(plan.total_weeks);
  if (totalWeeks > 0) blocks.push({ kind: "paragraph", text: `Planned duration: ${totalWeeks} weeks. Milestones are planning targets, not guarantees.` });
  for (const phase of phases.slice(0, 12)) {
    const title = text(phase.name) || text(phase.title) || "Roadmap phase";
    const weeks = number(phase.weeks, number(phase.duration_weeks));
    blocks.push({ kind: "heading", text: `${title}${weeks ? ` (${weeks} weeks)` : ""}` });
    for (const item of array(phase.items).slice(0, 10)) {
      const row = record(item);
      const itemTitle = text(row.title) || text(row.name) || String(item);
      const why = text(row.why_now) || text(row.why) || "";
      const deliverable = text(row.key_deliverable) || text(row.deliverable) || "";
      blocks.push({ kind: "bullet", text: [itemTitle, why && `Why now: ${why}`, deliverable && `Deliverable: ${deliverable}`].filter(Boolean).join(" | ") });
    }
  }
  const moonshots = strings(plan.moonshots);
  if (moonshots.length > 0) {
    blocks.push({ kind: "heading", text: "Moonshots / Long-term Optionality" });
    moonshots.slice(0, 12).forEach((item) => blocks.push({ kind: "bullet", text: item }));
  }
  return blocks;
}

router.get(
  "/investor-report/:id.pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [{ data: analysis, error }, itemsResult] = await Promise.all([
      req.supabase!
        .from("analyses")
        .select("repo_count, summary_md, portfolio_stats, investment_intelligence, created_at")
        .eq("id", id)
        .eq("user_id", req.userId!)
        .maybeSingle(),
      req.supabase!
        .from("analysis_items")
        .select("rank, kind, title, pitch, repos, next_steps, effort, market_potential, estimated_hours")
        .eq("analysis_id", id)
        .order("rank", { ascending: true }),
    ]);
    if (error) throw new Error(`Failed to load analysis for investor report: ${error.message}`);
    if (!analysis) throw Object.assign(new Error("Analysis not found"), { status: 404 });
    if (itemsResult.error) throw new Error(`Failed to load analysis roadmap items: ${itemsResult.error.message}`);

    const analysisRow = record(analysis);
    const intelligence = record(analysisRow.investment_intelligence);
    const ranking = array(intelligence.ranking).map(record);
    if (ranking.length === 0) {
      throw Object.assign(new Error("Run Full Portfolio Value before exporting an investor report so the PDF has evidence-backed repository valuation data."), { status: 409 });
    }
    const inputs = ranking.map(valuationInput).filter((value): value is PortfolioValuationRepoInput => value !== null);
    const valuation = buildPortfolioValuation(inputs);
    const portfolio = record(intelligence.portfolio);
    const top = ranking[0];
    const portfolioStats = record(analysisRow.portfolio_stats);
    const reportDate = new Date().toISOString().slice(0, 10);
    const repoCount = number(analysisRow.repo_count, number(portfolio.reposRequested, ranking.length));
    const reposScored = number(portfolio.reposScored, ranking.length);
    const recommendation = text(intelligence.recommendation) || (top ? `Finish ${text(top.repo) || "the highest-ranked repository"} first.` : "No finish-first recommendation available.");
    const evidencePolicy = text(intelligence.evidencePolicy) || "Market and upside figures are planning estimates. Unverified revenue, customers, TAM, market share, and competition are not treated as facts.";

    const blocks: PdfBlock[] = [
      { kind: "paragraph", text: `Analysis ID: ${id}` },
      { kind: "paragraph", text: `Generated: ${reportDate}. Portfolio analysis originally created: ${text(analysisRow.created_at) || "unknown"}.` },
      { kind: "heading", text: "Executive Summary" },
      { kind: "paragraph", text: recommendation },
      { kind: "paragraph", text: `Repository universe in this analysis: ${repoCount}. Repositories valued successfully: ${reposScored}.` },
      { kind: "paragraph", text: evidencePolicy },
      { kind: "heading", text: "Confidence-adjusted Portfolio Value" },
      { kind: "bullet", text: `Adjusted current value: ${range(valuation.confidenceAdjustedPortfolioValueUsd)}. Gross standalone: ${range(valuation.grossStandalonePresentValueUsd)}.` },
      { kind: "bullet", text: `Adjusted potential scenario: ${range(valuation.confidenceAdjustedPotentialValueUsd)}. Gross standalone potential: ${range(valuation.grossStandalonePotentialValueUsd)}.` },
      { kind: "bullet", text: `Replacement cost: ${money(valuation.replacementCostUsd.base)} (${money(valuation.replacementCostUsd.low)} - ${money(valuation.replacementCostUsd.high)}).` },
      { kind: "bullet", text: `Evidence confidence: ${Math.round(valuation.averageConfidencePct)}%. Repositories scored: ${valuation.reposScored}.` },
      { kind: "bullet", text: `Duplicate-IP discount: ${range(valuation.overlapDiscountUsd)} (${valuation.overlapPct}% of confidence-adjusted gross).` },
      { kind: "bullet", text: `Capped synergy shown separately: ${range(valuation.synergyUpliftUsd)}.` },
      { kind: "heading", text: "Top Finish-first Opportunities" },
    ];

    ranking.slice(0, 12).forEach((item, index) => {
      const repo = text(item.repo) || `Repository ${index + 1}`;
      const details = record(item.details);
      blocks.push({
        kind: "bullet",
        text: `#${number(item.rank, index + 1)} ${repo}: finish-first ${number(item.finishFirstScore).toFixed(1)}/100; completion ${Math.round(number(item.completionPct))}%; readiness ${Math.round(number(item.productionReadinessPct))}%; present ${range(moneyRange(item.presentValueUsd))}; potential ${range(moneyRange(item.potentialValueUsd))}; commercialization ${Math.round(number(item.commercializationProbability))}%; evidence ${Math.round(number(item.evidenceConfidence))}/100.${text(details.pitch) ? ` ${text(details.pitch)}` : ""}`,
      });
    });

    const analysisItems = (itemsResult.data ?? []) as Array<Record<string, unknown>>;
    if (analysisItems.length > 0) {
      blocks.push({ kind: "heading", text: "Recommended Product Work" });
      analysisItems.slice(0, 20).forEach((item) => {
        const repos = strings(item.repos);
        blocks.push({
          kind: "bullet",
          text: `#${number(item.rank)} ${text(item.title) || "Recommendation"}${repos.length ? ` [${repos.join(", ")}]` : ""}: ${text(item.pitch) || ""} Next: ${strings(item.next_steps).slice(0, 3).join("; ") || "No next steps recorded."}`,
        });
      });
    }

    blocks.push(...phaseBlocks(portfolioStats));
    blocks.push(
      { kind: "heading", text: "Investor Diligence Priorities" },
      { kind: "bullet", text: "Verify revenue, paid customers, retention, conversion, churn, and unit economics independently. Repository code is not proof of commercial traction." },
      { kind: "bullet", text: "Reconcile canonical products versus donor, legacy, duplicate, experiment, and placeholder repositories before applying portfolio-level multiples." },
      { kind: "bullet", text: "Verify production deployments, core user journeys, authentication/authorization, payments where applicable, migrations, security controls, observability, and recovery procedures." },
      { kind: "bullet", text: "Perform source-backed competitor, pricing, and market research. RepoFinisher intentionally does not fabricate competition or saturation evidence." },
      { kind: "bullet", text: "Review IP ownership, third-party/open-source licenses, generated-code provenance, trademarks/domains, and contributor assignments." },
      { kind: "heading", text: "Valuation Disclaimer" },
      { kind: "paragraph", text: "RepoFinisher valuation outputs are planning estimates derived from repository evidence, structural heuristics, confidence adjustments, overlap treatment, replacement cost, and explicit commercialization scenarios. They are not audited financial results, certified appraisals, transaction comparables, securities valuations, fairness opinions, or guarantees of realizable value." },
      { kind: "paragraph", text: "Potential and revenue-related scenarios require successful implementation, distribution, pricing, customer acquisition, retention, and acceptable unit economics. Independent financial, legal, tax, security, IP, and market diligence is required before financing or acquisition decisions." },
    );

    const pdf = createSimplePdf("RepoFinisher Investor Portfolio Report", blocks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=repofinisher-investor-report-${id.slice(0, 8)}-${reportDate}.pdf`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  }),
);

export default router;
