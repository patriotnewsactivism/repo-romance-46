import { useState } from "react";
import {
  useAssessMarketAndValue,
  useGenerateVibeSpec,
  useCombineRepos,
  useIterativeFinish,
  type MarketAnalysis,
  type MarketValuation,
  type VibeSpec,
  type CombineResult,
  type IterativeFinishPass,
} from "@workspace/api-client-react";
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
import { toast } from "sonner";

interface VibeToolsPanelProps {
  analysisId: string;
  itemRank: number;
  kind: string;
  repos: string[];
}

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}

function copy(t: string, label: string) {
  navigator.clipboard.writeText(t).then(() => toast.success(`${label} copied`));
}

export function VibeToolsPanel({ analysisId, itemRank, kind, repos }: VibeToolsPanelProps) {
  const [market, setMarket] = useState<MarketAnalysis | null>(null);
  const [valuation, setValuation] = useState<MarketValuation | null>(null);
  const [spec, setSpec] = useState<VibeSpec | null>(null);
  const [combine, setCombine] = useState<CombineResult | null>(null);
  const [history, setHistory] = useState<IterativeFinishPass[]>([]);

  const marketMut = useAssessMarketAndValue();
  const specMut = useGenerateVibeSpec();
  const combineMut = useCombineRepos();
  const iterMut = useIterativeFinish();

  const handleMarket = () => {
    marketMut.mutate(
      { data: { analysisId, itemRank } },
      {
        onSuccess: (r) => {
          setMarket(r.market);
          setValuation(r.valuation);
          toast.success("Market & valuation ready");
        },
        onError: (e) => toast.error(e.message.slice(0, 200)),
      },
    );
  };

  const handleSpec = () => {
    specMut.mutate(
      { data: { analysisId, itemRank } },
      {
        onSuccess: (r) => {
          setSpec(r);
          toast.success("Vibe spec generated");
        },
        onError: (e) => toast.error(e.message.slice(0, 200)),
      },
    );
  };

  const handleCombine = () => {
    combineMut.mutate(
      { data: { analysisId, itemRank } },
      {
        onSuccess: (r) => {
          setCombine(r);
          toast.success("Combined repo created");
        },
        onError: (e) => toast.error(e.message.slice(0, 200)),
      },
    );
  };

  const handleIterate = () => {
    iterMut.mutate(
      { data: { analysisId, itemRank, repo: repos[0], passes: 3 } },
      {
        onSuccess: (r) => {
          setHistory(r.history);
          toast.success(`Ran ${r.history.filter((h) => h.pr_url).length} finish passes`);
        },
        onError: (e) => toast.error(e.message.slice(0, 200)),
      },
    );
  };

  return (
    <div className="pt-3 border-t border-border space-y-3">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        Vibe tools
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleMarket}
          disabled={marketMut.isPending}
          className="gap-1.5 justify-start"
          data-testid="button-vibe-market-value"
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
          onClick={handleSpec}
          disabled={specMut.isPending}
          className="gap-1.5 justify-start"
          data-testid="button-vibe-spec"
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
            onClick={handleIterate}
            disabled={iterMut.isPending}
            className="gap-1.5 justify-start"
            data-testid="button-vibe-iterate"
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
            onClick={handleCombine}
            disabled={combineMut.isPending}
            className="gap-1.5 justify-start"
            data-testid="button-vibe-combine"
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
                  {fmtUsd(valuation.low_usd)} – {fmtUsd(valuation.high_usd)}
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
                        <span className="text-muted-foreground">— {c.differentiator}</span>
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
                  <code className="bg-muted px-1 rounded">{s.path}</code> — {s.purpose}
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
              {h.summary && (
                <div className="text-xs text-muted-foreground mt-0.5">{h.summary}</div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
