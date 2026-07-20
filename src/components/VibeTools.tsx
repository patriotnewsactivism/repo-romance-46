import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  assessMarketAndValue,
  generateVibeSpec,
  combineRepos,
  iterativeFinish,
} from "@/lib/vibe-tools.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  TrendingUp,
  Rocket,
  GitMerge,
  Loader2,
  ExternalLink,
  Copy,
  DollarSign,
} from "lucide-react";

interface Props {
  analysisId: string;
  itemRank: number;
  kind: string;
  repos: string[];
  existing: {
    market_analysis?: unknown;
    valuation?: unknown;
    vibe_spec?: unknown;
    combine_result?: unknown;
    finish_history?: unknown;
    iteration_count?: number;
  };
}

type MarketData = {
  tam_summary: string;
  target_users: string[];
  competitors: { name: string; url: string; differentiator: string }[];
  monetization: string[];
  demand_score: number;
  ship_readiness_score: number;
  risks: string[];
  verdict: string;
};
type ValuationData = { low_usd: number; mid_usd: number; high_usd: number; reasoning: string };
type VibeSpec = {
  product_name: string;
  tagline: string;
  prd_md: string;
  lovable_prompt: string;
  landing_hero: string;
  landing_subhead: string;
  landing_bullets: string[];
  cta: string;
  launch_checklist: string[];
};
type CombineResult = {
  combined_repo: string;
  combined_url: string;
  source_issues: { repo: string; url: string }[];
  structure: { path: string; purpose: string }[];
};
type FinishHistoryEntry = {
  pass: number;
  pr_url?: string;
  pr_number?: number;
  files_changed?: number;
  summary?: string;
  error?: string;
};

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}

function copy(t: string, label: string) {
  navigator.clipboard.writeText(t).then(() => toast.success(`${label} copied`));
}

export function VibeTools({ analysisId, itemRank, kind, repos, existing }: Props) {
  const [market, setMarket] = useState<MarketData | null>(
    (existing.market_analysis as MarketData) || null,
  );
  const [valuation, setValuation] = useState<ValuationData | null>(
    (existing.valuation as ValuationData) || null,
  );
  const [spec, setSpec] = useState<VibeSpec | null>((existing.vibe_spec as VibeSpec) || null);
  const [combine, setCombine] = useState<CombineResult | null>(
    (existing.combine_result as CombineResult) || null,
  );
  const [history, setHistory] = useState<FinishHistoryEntry[]>(
    (existing.finish_history as FinishHistoryEntry[]) || [],
  );

  const marketMut = useMutation({
    mutationFn: () => assessMarketAndValue({ data: { analysisId, itemRank } }),
    onSuccess: (d) => {
      const r = d as { market: MarketData; valuation: ValuationData };
      setMarket(r.market);
      setValuation(r.valuation);
      toast.success("Market & valuation ready");
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  const specMut = useMutation({
    mutationFn: () => generateVibeSpec({ data: { analysisId, itemRank } }),
    onSuccess: (d) => {
      setSpec(d as VibeSpec);
      toast.success("Vibe spec generated");
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  const combineMut = useMutation({
    mutationFn: () => combineRepos({ data: { analysisId, itemRank } }),
    onSuccess: (d) => {
      setCombine(d as CombineResult);
      toast.success("Combined repo created");
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  const iterMut = useMutation({
    mutationFn: () =>
      iterativeFinish({ data: { analysisId, itemRank, repo: repos[0], passes: 3 } }),
    onSuccess: (d) => {
      const r = d as { history: FinishHistoryEntry[] };
      setHistory(r.history);
      toast.success(`Ran ${r.history.filter((h) => h.pr_url).length} finish passes`);
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  return (
    <div className="pt-3 border-t border-border space-y-3">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        Vibe tools
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => marketMut.mutate()}
          disabled={marketMut.isPending}
          className="gap-1.5 justify-start"
        >
          {marketMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <TrendingUp className="h-3.5 w-3.5" />
          )}
          Assess market & value
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => specMut.mutate()}
          disabled={specMut.isPending}
          className="gap-1.5 justify-start"
        >
          {specMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Generate vibe spec
        </Button>

        {kind === "finish" && repos.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => iterMut.mutate()}
            disabled={iterMut.isPending}
            className="gap-1.5 justify-start"
          >
            {iterMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Iterative auto-finish (3 passes)
          </Button>
        )}

        {kind === "combine" && repos.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => combineMut.mutate()}
            disabled={combineMut.isPending}
            className="gap-1.5 justify-start"
          >
            {combineMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitMerge className="h-3.5 w-3.5" />
            )}
            Create combined repo
          </Button>
        )}
      </div>

      {/* Market & Valuation display */}
      {(market || valuation) && (
        <Card className="p-3 space-y-3 bg-muted/20">
          {valuation && (
            <div className="flex items-center gap-3 pb-2 border-b border-border/50">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              <div className="text-sm">
                <span className="font-semibold">
                  {fmtUsd(valuation.low_usd)} â {fmtUsd(valuation.high_usd)}
                </span>
                <span className="text-muted-foreground ml-2">
                  (mid {fmtUsd(valuation.mid_usd)})
                </span>
              </div>
            </div>
          )}
          {market && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">Demand {market.demand_score}/100</Badge>
                <Badge variant="secondary">Ready {market.ship_readiness_score}/100</Badge>
                <Badge>{market.verdict.replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{market.tam_summary}</p>
              {market.competitors.length > 0 && (
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">Competitors</div>
                  <ul className="space-y-1 text-sm">
                    {market.competitors.slice(0, 5).map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-500 hover:underline"
                        >
                          {c.name}
                        </a>
                        <span className="text-muted-foreground">â {c.differentiator}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {market.monetization.length > 0 && (
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">Monetization</div>
                  <ul className="list-disc list-inside text-sm space-y-0.5">
                    {market.monetization.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {valuation && (
                <p className="text-xs text-muted-foreground italic">{valuation.reasoning}</p>
              )}
            </>
          )}
        </Card>
      )}

      {/* Vibe spec display */}
      {spec && (
        <Card className="p-3 space-y-3 bg-muted/20">
          <div>
            <div className="text-xs font-mono text-muted-foreground">Product</div>
            <div className="font-semibold">{spec.product_name}</div>
            <div className="text-sm text-muted-foreground italic">{spec.tagline}</div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-mono text-muted-foreground">
                Lovable prompt (paste & ship)
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() => copy(spec.lovable_prompt, "Prompt")}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <pre className="text-xs bg-background border border-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
              {spec.lovable_prompt}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-mono text-muted-foreground">PRD</div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() => copy(spec.prd_md, "PRD")}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <pre className="text-xs bg-background border border-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
              {spec.prd_md}
            </pre>
          </div>
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-1">Launch checklist</div>
            <ol className="list-decimal list-inside text-sm space-y-0.5">
              {spec.launch_checklist.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      {/* Combine result */}
      {combine && (
        <Card className="p-3 space-y-2 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-emerald-500" />
            <span className="font-semibold text-sm">{combine.combined_repo}</span>
            <a
              href={combine.combined_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-blue-500 hover:underline flex items-center gap-1"
            >
              Open repo <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {combine.source_issues.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Tracking issues opened on: {combine.source_issues.map((s) => s.repo).join(", ")}
            </div>
          )}
          <details>
            <summary className="text-xs cursor-pointer text-muted-foreground">
              Structure ({combine.structure.length} folders)
            </summary>
            <ul className="mt-1 text-xs space-y-0.5">
              {combine.structure.map((s, i) => (
                <li key={i}>
                  <code className="bg-muted px-1 rounded">{s.path}</code> â {s.purpose}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {/* Iterative finish history */}
      {history.length > 0 && (
        <Card className="p-3 space-y-2 bg-muted/20">
          <div className="text-xs font-mono text-muted-foreground">
            Auto-finish passes ({history.filter((h) => h.pr_url).length}/{history.length})
          </div>
          {history.map((h, i) => (
            <div key={i} className="text-sm border-l-2 border-border pl-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">Pass {h.pass}</span>
                {h.pr_url ? (
                  <a
                    href={h.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline text-xs"
                  >
                    PR #{h.pr_number} ({h.files_changed} files)
                  </a>
                ) : (
                  <span className="text-xs text-red-500">{h.error}</span>
                )}
              </div>
              {h.summary && <div className="text-xs text-muted-foreground mt-0.5">{h.summary}</div>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
