import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CapabilityGuide } from '@/components/capability-guide';
import { FinishRepoAction } from '@/components/finish-repo-action';
import { FinishUntilTargetControl } from '@/components/finish-until-target-control';
import { PortfolioFinishControl } from '@/components/portfolio-finish-control';
import { TieredIntelligencePanel } from '@/components/tiered-intelligence-panel';
import { PortfolioValuationV2Panel } from '@/components/portfolio-valuation-v2-panel';
import {
  AlertTriangle,
  DollarSign,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';

type EvidenceClass = 'verified' | 'derived' | 'model_estimate' | 'insufficient';

interface EvidenceItem {
  class: EvidenceClass;
  label: string;
  detail: string;
  source?: string;
}

interface RankingItem {
  repo: string;
  rank: number;
  finishFirstScore: number;
  completionPct: number;
  productionReadinessPct: number;
  presentValueUsd: { low: number; high: number };
  potentialValueUsd: { low: number; high: number };
  marketNeed: number;
  demand: number;
  competitivePressure: number;
  commercializationProbability: number;
  remainingWork: { hours: number; costUsd: { low: number; high: number } };
  evidenceConfidence: number;
  evidence: EvidenceItem[];
  rationale: string[];
  details?: {
    kind?: string;
    title?: string;
    pitch?: string;
    recommendedNextSteps?: string[];
    market?: { market_summary?: string };
  };
}

interface IntelligenceResult {
  methodologyVersion: string;
  generatedAt: string;
  analysisId: string;
  ranking: RankingItem[];
  errors: string[];
  portfolio: {
    reposRequested?: number;
    reposScored: number;
    coveragePct?: number;
    partialFailures?: number;
    scope?: string;
    presentValueLow: number;
    presentValueHigh: number;
    potentialValueLow: number;
    potentialValueHigh: number;
    weightedCommercializationProbability: number;
  };
  recommendation: string;
  evidencePolicy: string;
}

function money(value: number) {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

function scoreClass(score: number) {
  if (score >= 75) return 'text-emerald-500 border-emerald-500/30';
  if (score >= 55) return 'text-amber-500 border-amber-500/30';
  return 'text-muted-foreground border-border';
}

function evidenceClass(item: EvidenceItem) {
  switch (item.class) {
    case 'verified': return 'border-emerald-500/30 text-emerald-500';
    case 'derived': return 'border-blue-500/30 text-blue-500';
    case 'model_estimate': return 'border-violet-500/30 text-violet-500';
    default: return 'border-amber-500/30 text-amber-500';
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return customFetch<T>(path, {
    method: 'POST',
    responseType: 'json',
    body: JSON.stringify(body ?? {}),
  });
}

export function InvestmentIntelligenceView({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<IntelligenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await customFetch<IntelligenceResult | null>(`/api/portfolio-intelligence/${analysisId}`, { responseType: 'json' });
      setData(existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load portfolio intelligence.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [analysisId]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await postJson<IntelligenceResult>(`/api/portfolio-intelligence/${analysisId}`);
      setData(result);
      toast.success(`Valued and ranked ${result.portfolio.reposScored} repositories across the portfolio.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Portfolio intelligence failed.';
      setError(message);
      toast.error(message.slice(0, 240));
    } finally {
      setRunning(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="p-6 flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading full portfolio intelligence…
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <CapabilityGuide />
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Full Portfolio Value & Finish Priority</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Value every repository recorded in this analysis, rank the best finish-first opportunities, and launch the autonomous finisher directly from the ranking. This replaces the old 30-repository intelligence ceiling.
          </p>
          {error && <p className="text-sm text-red-500 break-words">{error}</p>}
          <Button onClick={run} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            {running ? 'Valuing full portfolio…' : 'Calculate Full Portfolio Value'}
          </Button>
        </Card>
      </div>
    );
  }

  const requested = data.portfolio.reposRequested ?? data.portfolio.reposScored;
  const coverage = data.portfolio.coveragePct ?? (requested > 0 ? Math.round((data.portfolio.reposScored / requested) * 1000) / 10 : 0);

  return (
    <div className="space-y-4">
      <CapabilityGuide />
      <Card className="p-4 sm:p-6 space-y-5 border-primary/20 overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4 text-primary shrink-0" />
              Finish-first recommendation
            </div>
            <h3 className="text-lg sm:text-xl font-semibold break-words">{data.recommendation}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{data.evidencePolicy}</p>
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={running} className="gap-2 shrink-0">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh full portfolio
          </Button>
        </div>

        <div className="grid gap-3 grid-cols-2 xl:grid-cols-5">
          <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
            <div className="text-xs text-muted-foreground">Standalone portfolio value</div>
            <div className="font-semibold text-lg break-words">{money(data.portfolio.presentValueLow)}–{money(data.portfolio.presentValueHigh)}</div>
            <div className="text-[11px] text-muted-foreground">Before confidence and overlap adjustment</div>
          </div>
          <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
            <div className="text-xs text-muted-foreground">Standalone potential</div>
            <div className="font-semibold text-lg break-words">{money(data.portfolio.potentialValueLow)}–{money(data.portfolio.potentialValueHigh)}</div>
            <div className="text-[11px] text-muted-foreground">Scenario estimate before confidence adjustment</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Commercialization</div>
            <div className="font-semibold">{data.portfolio.weightedCommercializationProbability}%</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Repos valued</div>
            <div className="font-semibold">{data.portfolio.reposScored}/{requested}</div>
          </div>
          <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
            <div className="text-xs text-muted-foreground">Coverage</div>
            <div className="font-semibold">{coverage}%</div>
            <div className="text-[11px] text-muted-foreground">{data.portfolio.scope || 'analysis portfolio'}</div>
          </div>
        </div>
      </Card>

      <PortfolioValuationV2Panel analysisId={analysisId} sourceGeneratedAt={data.generatedAt} />
      <PortfolioFinishControl analysisId={analysisId} repoCount={data.ranking.length} />
      <TieredIntelligencePanel analysisId={analysisId} repoCount={data.ranking.length} />

      {data.errors.length > 0 && (
        <Card className="p-4 border-amber-500/30">
          <div className="flex gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{data.errors.length} repository(s) could not be valued. The totals above include every successful repository score and show the exact coverage percentage.</span>
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Show failures</summary>
            <ul className="mt-2 space-y-1 break-words">
              {data.errors.map((message, index) => <li key={index}>• {message}</li>)}
            </ul>
          </details>
        </Card>
      )}

      {data.ranking.map((item) => (
        <Card key={item.repo} className="p-4 sm:p-5 space-y-4 overflow-hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">#{item.rank}</Badge>
                <span className="font-mono font-semibold break-all">{item.repo}</span>
                {item.details?.kind && <Badge variant="secondary">{item.details.kind}</Badge>}
              </div>
              {item.details?.pitch && <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.details.pitch}</p>}
              {item.rationale.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{item.rationale.join(' • ')}</p>}
            </div>
            <div className={`rounded-lg border px-4 py-2 text-center shrink-0 ${scoreClass(item.finishFirstScore)}`}>
              <div className="text-2xl font-bold">{item.finishFirstScore}</div>
              <div className="text-[10px] uppercase font-mono">finish first</div>
            </div>
          </div>

          <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Completion</div><div className="font-semibold">{item.completionPct}%</div><div className="text-[11px] text-muted-foreground">Readiness {item.productionReadinessPct}%</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Standalone present → potential</div><div className="font-semibold break-words">{money(item.presentValueUsd.low)}–{money(item.presentValueUsd.high)}</div><div className="text-[11px] text-emerald-500 break-words">→ {money(item.potentialValueUsd.low)}–{money(item.potentialValueUsd.high)}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Remaining work</div><div className="font-semibold">~{Math.round(item.remainingWork.hours)}h</div><div className="text-[11px] text-muted-foreground break-words">{money(item.remainingWork.costUsd.low)}–{money(item.remainingWork.costUsd.high)}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Commercialization</div><div className="font-semibold">{item.commercializationProbability}%</div><div className="text-[11px] text-muted-foreground">Evidence {item.evidenceConfidence}/100</div></div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded border p-3 text-sm flex justify-between gap-3"><span className="text-muted-foreground">Market need</span><span className="font-semibold">{item.marketNeed}/100</span></div>
            <div className="rounded border p-3 text-sm flex justify-between gap-3"><span className="text-muted-foreground">Demand</span><span className="font-semibold">{item.demand}/100</span></div>
            <div className="rounded border p-3 text-sm flex justify-between gap-3"><span className="text-muted-foreground">Competitive pressure</span><span className="font-semibold">{item.competitivePressure}/100</span></div>
          </div>

          <FinishRepoAction repo={item.repo} nextSteps={item.details?.recommendedNextSteps ?? []} analysisId={analysisId} />
          <FinishUntilTargetControl repo={item.repo} nextSteps={item.details?.recommendedNextSteps ?? []} analysisId={analysisId} />

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" /> Evidence ledger</summary>
            <div className="mt-3 space-y-2">
              {item.evidence.map((evidence, index) => (
                <div key={`${evidence.label}-${index}`} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline" className={evidenceClass(evidence)}>{evidence.class.replace('_', ' ')}</Badge><span className="text-sm font-medium">{evidence.label}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{evidence.detail}</p>
                </div>
              ))}
            </div>
          </details>
        </Card>
      ))}
    </div>
  );
}
