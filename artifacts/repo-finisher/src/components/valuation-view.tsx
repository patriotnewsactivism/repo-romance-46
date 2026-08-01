import { useState } from "react";
import { useRunValuation, useGetValuation, getGetValuationQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  TrendingUp,
  Loader2,
  AlertTriangle,
  Sparkles,
  Target,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

const CONFIDENCE_STYLES = {
  high: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  medium: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10",
  low: "text-muted-foreground border-muted-foreground/30 bg-muted/10",
};

function formatMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

export function ValuationView({ analysisId }: { analysisId: string }) {
  const [expandedRepo, setExpandedRepo] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const existing = useGetValuation(analysisId);
  const runValuation = useRunValuation();

  const handleRun = () => {
    runValuation.mutate(
      { id: analysisId },
      {
        onSuccess: () => {
          toast.success("Portfolio valued!");
          queryClient.invalidateQueries({ queryKey: getGetValuationQueryKey(analysisId) });
        },
        onError: (error) => toast.error(error.message.slice(0, 200)),
      },
    );
  };

  const data = existing.data;
  // existing.isFetching covers both the very first load AND the background
  // refetch triggered by invalidateQueries after a run — without it, the
  // empty-state CTA below would briefly flash back on top of (or instead of)
  // real data while either fetch is still in flight.
  const isBusy = runValuation.isPending || existing.isFetching;

  if (isBusy && !data) {
    return (
      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
          <h3 className="font-semibold">
            {runValuation.isPending ? 'Valuing your portfolio...' : 'Loading valuation...'}
          </h3>
        </div>
        {runValuation.isPending && (
          <div className="text-xs text-muted-foreground space-y-1 pl-7">
            <p>• Fetching GitHub metrics for each repo (stars, commits, CI, tests)</p>
            <p>• Analyzing code quality, market potential, and traction signals</p>
            <p>• Finding comparable acquisitions and exits</p>
            <p>• Calculating estimated value ranges and revenue potential</p>
          </div>
        )}
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-500" />
          <h3 className="font-semibold">Portfolio Valuation</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Get an AI-powered valuation of your repos — estimated market value, revenue potential,
          comparable acquisitions, risk factors, and upside catalysts.
        </p>
        <Button onClick={handleRun} disabled={runValuation.isPending} className="gap-2" data-testid="button-run-valuation">
          <TrendingUp className="h-4 w-4" />
          Value My Portfolio
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with total */}
      <Card className="p-6 border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Portfolio Estimated Value
            </div>
            <div className="text-3xl font-bold">
              {formatMoney(data.total_estimated_value_low)} —{" "}
              {formatMoney(data.total_estimated_value_high)}
            </div>
            <p className="text-xs text-muted-foreground">{data.portfolio_summary}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              Diversification: {data.diversification_score}/10
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRun}
              disabled={runValuation.isPending}
              className="text-xs"
              data-testid="button-refresh-valuation"
            >
              Refresh Valuation
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3">
          <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 mb-1">
            <Lightbulb className="h-3 w-3" /> RECOMMENDATION
          </div>
          <p className="text-sm">{data.recommendation}</p>
        </div>
      </Card>

      {/* Top picks */}
      {data.top_picks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.top_picks.map((pick, i) => (
            <Card key={i} className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                <Target className="h-3 w-3" /> TOP PICK #{i + 1}
              </div>
              <p className="text-sm">{pick.reason}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Individual repo valuations */}
      <div className="space-y-3">
        <h3 className="text-sm font-mono uppercase text-muted-foreground">
          Individual Repo Valuations ({data.repo_valuations.length})
        </h3>
        {data.repo_valuations.map((v, i) => (
          <Card key={v.repo || i} className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{v.repo}</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono ${CONFIDENCE_STYLES[v.confidence]}`}
                  >
                    {v.confidence} confidence
                  </span>
                  <span className="text-xs text-muted-foreground">{v.valuation_method}</span>
                </div>
                <p className="text-sm text-muted-foreground">{v.summary}</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">
                  {formatMoney(v.estimated_value_low)} — {formatMoney(v.estimated_value_high)}
                </div>
              </div>
            </div>

            {/* Toggle details */}
            <button
              onClick={() => setExpandedRepo(expandedRepo === i ? null : i)}
              className="text-xs font-mono text-muted-foreground hover:text-foreground"
            >
              {expandedRepo === i ? "▾ hide breakdown" : "▸ show breakdown"}
            </button>

            {expandedRepo === i && (
              <div className="space-y-4 pt-2 border-t border-border">
                {/* Revenue potential */}
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                    <DollarSign className="h-3 w-3" /> REVENUE POTENTIAL
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{v.revenue_potential.model}</span>
                    <span className="text-sm font-semibold">
                      {formatMoney(v.revenue_potential.monthly_revenue_low)} —{" "}
                      {formatMoney(v.revenue_potential.monthly_revenue_high)}/mo
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Timeline: {v.revenue_potential.timeline}
                  </p>
                </div>

                {/* Factors */}
                <div className="space-y-2">
                  <div className="text-xs font-mono text-muted-foreground">VALUATION FACTORS</div>
                  {v.factors.map((f, j) => (
                    <div key={j} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{f.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {f.score}/10 (weight: {f.weight})
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${f.score * 10}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{f.detail}</p>
                    </div>
                  ))}
                </div>

                {/* Comparables */}
                {v.comparables.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-muted-foreground">
                      COMPARABLE ACQUISITIONS
                    </div>
                    {v.comparables.map((c, j) => (
                      <div
                        key={j}
                        className="flex items-start gap-2 rounded-md border border-border p-2"
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.outcome} — {c.multiple}
                          </div>
                          <div className="text-xs text-muted-foreground italic">{c.relevance}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Risks & Upsides */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-mono text-red-500">
                      <ArrowDownRight className="h-3 w-3" /> RISKS
                    </div>
                    {v.risks.map((r, j) => (
                      <div
                        key={j}
                        className="flex items-start gap-1.5 text-xs rounded-md border border-red-500/20 bg-red-500/5 p-2"
                      >
                        <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-500">
                      <ArrowUpRight className="h-3 w-3" /> UPSIDES
                    </div>
                    {v.upsides.map((u, j) => (
                      <div
                        key={j}
                        className="flex items-start gap-1.5 text-xs rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2"
                      >
                        <Sparkles className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{u}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
