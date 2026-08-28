import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronDown, Loader2, RefreshCw, ShieldCheck, Sigma, WalletCards } from 'lucide-react';

type MoneyRange = { low: number; high: number };

interface RepoValuation {
  repo: string;
  confidencePct: number;
  standalonePresentValueUsd: MoneyRange;
  adjustedPresentValueUsd: MoneyRange;
  adjustedPotentialValueUsd: MoneyRange;
  overlapDiscountUsd: MoneyRange;
  synergyContributionUsd: MoneyRange;
  replacementCostUsd: { low: number; base: number; high: number };
  monetizationReadinessScore: number;
  demandProxyScore: number;
  distributionAdvantageScore: number;
  recurringRevenuePotentialScore: number;
  competitiveSaturationScore: number | null;
  overlapSimilarityPct: number;
  overlapWithRepo: string | null;
}

interface PortfolioValuationV2 {
  methodologyVersion: string;
  reposScored: number;
  averageConfidencePct: number;
  grossStandalonePresentValueUsd: MoneyRange;
  confidenceAdjustedBeforeOverlapUsd: MoneyRange;
  overlapDiscountUsd: MoneyRange;
  synergyUpliftUsd: MoneyRange;
  confidenceAdjustedPortfolioValueUsd: MoneyRange;
  grossStandalonePotentialValueUsd: MoneyRange;
  confidenceAdjustedPotentialValueUsd: MoneyRange;
  replacementCostUsd: { low: number; base: number; high: number };
  overlapPct: number;
  repos: RepoValuation[];
  evidencePolicy: string;
}

function money(value: number) {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

function range(value: MoneyRange) {
  return `${money(value.low)}–${money(value.high)}`;
}

export function PortfolioValuationV2Panel({
  analysisId,
  sourceGeneratedAt,
}: {
  analysisId: string;
  sourceGeneratedAt?: string;
}) {
  const [data, setData] = useState<PortfolioValuationV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await customFetch<PortfolioValuationV2>(`/api/portfolio-valuation-v2/${analysisId}`, {
        responseType: 'json',
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to calculate confidence-adjusted portfolio value.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [analysisId, sourceGeneratedAt]);

  const recalculate = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await customFetch<PortfolioValuationV2>(`/api/portfolio-valuation-v2/${analysisId}`, {
        method: 'POST',
        responseType: 'json',
        body: JSON.stringify({}),
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save confidence-adjusted portfolio value.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="p-4 sm:p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calculating confidence, IP overlap, replacement cost, and portfolio synergy…
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-4 sm:p-5 space-y-2 border-amber-500/30">
        <div className="font-medium">Confidence-adjusted Portfolio V2</div>
        <p className="text-sm text-muted-foreground">{error || 'Run Full Portfolio Value first.'}</p>
        <Button variant="outline" size="sm" onClick={load}>Retry</Button>
      </Card>
    );
  }

  const duplicateRepos = data.repos.filter((repo) => repo.overlapWithRepo);
  const biggestOverlap = [...duplicateRepos]
    .sort((a, b) => b.overlapDiscountUsd.high - a.overlapDiscountUsd.high)
    .slice(0, 8);

  return (
    <Card className="p-4 sm:p-6 space-y-5 border-emerald-500/20 overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" />
            <h3 className="font-semibold text-lg">Confidence-adjusted Portfolio Value</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Gross standalone estimates are discounted for evidence quality and duplicated IP, then a small capped synergy uplift is shown separately. This avoids simply adding every repository's headline estimate together.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={recalculate} disabled={saving} className="gap-2 shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Recalculate & save
        </Button>
      </div>

      {error && <p className="text-sm text-red-500 break-words">{error}</p>}

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground">Adjusted current value</div>
          <div className="text-lg font-semibold break-words">{range(data.confidenceAdjustedPortfolioValueUsd)}</div>
          <div className="text-[11px] text-muted-foreground">Gross {range(data.grossStandalonePresentValueUsd)}</div>
        </div>
        <div className="rounded-md border p-3 col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground">Adjusted potential</div>
          <div className="text-lg font-semibold break-words">{range(data.confidenceAdjustedPotentialValueUsd)}</div>
          <div className="text-[11px] text-muted-foreground">Speculative upside confidence-adjusted</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Replacement cost</div>
          <div className="font-semibold">{money(data.replacementCostUsd.base)}</div>
          <div className="text-[11px] text-muted-foreground">{money(data.replacementCostUsd.low)}–{money(data.replacementCostUsd.high)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Evidence confidence</div>
          <div className="font-semibold">{data.averageConfidencePct}%</div>
          <div className="text-[11px] text-muted-foreground">{data.reposScored} repos scored</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sigma className="h-3.5 w-3.5" /> Duplicate-IP discount</div>
          <div className="font-semibold mt-1">-{range(data.overlapDiscountUsd)}</div>
          <div className="text-[11px] text-muted-foreground">{data.overlapPct}% of confidence-adjusted gross</div>
        </div>
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><WalletCards className="h-3.5 w-3.5" /> Capped synergy</div>
          <div className="font-semibold mt-1">+{range(data.synergyUpliftUsd)}</div>
          <div className="text-[11px] text-muted-foreground">Shown separately; never silently netted into gross</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Competition evidence</div>
          <div className="font-semibold mt-1">Not invented</div>
          <div className="text-[11px] text-muted-foreground">Saturation stays unknown until independently verified</div>
        </div>
      </div>

      <details className="rounded border p-3">
        <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium">
          <ChevronDown className="h-4 w-4" /> Repository valuation drivers
        </summary>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[760px] space-y-2">
            {data.repos.map((repo) => (
              <div key={repo.repo} className="grid grid-cols-[minmax(180px,1.5fr)_90px_140px_100px_100px_100px] gap-3 items-center rounded border p-3 text-xs">
                <div className="font-mono break-all">{repo.repo}</div>
                <div><span className="text-muted-foreground">Confidence</span><div className="font-semibold">{repo.confidencePct}%</div></div>
                <div><span className="text-muted-foreground">Adjusted</span><div className="font-semibold">{range(repo.adjustedPresentValueUsd)}</div></div>
                <div><span className="text-muted-foreground">Monetize</span><div className="font-semibold">{repo.monetizationReadinessScore}/100</div></div>
                <div><span className="text-muted-foreground">Demand</span><div className="font-semibold">{repo.demandProxyScore}/100</div></div>
                <div><span className="text-muted-foreground">Recurring</span><div className="font-semibold">{repo.recurringRevenuePotentialScore}/100</div></div>
              </div>
            ))}
          </div>
        </div>
      </details>

      {biggestOverlap.length > 0 && (
        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Largest IP-overlap adjustments ({duplicateRepos.length})</summary>
          <div className="mt-3 space-y-2">
            {biggestOverlap.map((repo) => (
              <div key={repo.repo} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 justify-between rounded border p-3 text-xs">
                <span className="font-mono break-all">{repo.repo}</span>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="outline">{repo.overlapSimilarityPct}% similar</Badge>
                  <span className="text-muted-foreground">to {repo.overlapWithRepo}</span>
                  <span className="font-medium">discount {range(repo.overlapDiscountUsd)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">{data.evidencePolicy}</p>
    </Card>
  );
}
