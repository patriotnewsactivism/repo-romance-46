import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { planSwarm, executeSwarm } from "@/lib/swarm.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Loader2,
  Rocket,
  Sparkles,
  GitMerge,
  Shield,
  SkipForward,
  CheckCircle2,
  XCircle,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";

type Action = "iterative_finish" | "gentle_finish" | "combine" | "vibe_spec" | "skip";
interface PlanItem {
  item_rank: number;
  item_id: string;
  kind: string;
  title: string;
  repos: string[];
  impact: number;
  fragility: number;
  action: Action;
  reason: string;
}
interface ResultItem {
  item_rank: number;
  action: Action;
  status: "ok" | "error" | "skipped";
  message: string;
  pr_urls?: string[];
  combined_url?: string;
  duration_ms: number;
}

const ACTION_META: Record<Action, { label: string; icon: typeof Rocket; color: string }> = {
  iterative_finish: { label: "Iterative finish (3 PRs)", icon: Rocket, color: "text-ship" },
  gentle_finish: { label: "Gentle finish (docs/CI only)", icon: Shield, color: "text-amber-500" },
  combine: { label: "Combine repos", icon: GitMerge, color: "text-combine" },
  vibe_spec: { label: "Vibe spec", icon: Sparkles, color: "text-repurpose" },
  skip: { label: "Skip", icon: SkipForward, color: "text-muted-foreground" },
};

export function SwarmRunner({ analysisId }: { analysisId: string }) {
  const [swarmRunId, setSwarmRunId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [concurrency] = useState(5);

  const planMut = useMutation({
    mutationFn: () =>
      planSwarm({ data: { analysisId, concurrency, autonomyMode: "dry_run" } }),
    onSuccess: (d) => {
      const r = d as { swarmRunId: string; plan: PlanItem[]; summary: string };
      setSwarmRunId(r.swarmRunId);
      setPlan(r.plan);
      setSummary(r.summary);
      setResults(null);
      toast.success("Swarm plan ready — review before executing");
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  const execMut = useMutation({
    mutationFn: () => executeSwarm({ data: { swarmRunId: swarmRunId! } }),
    onSuccess: (d) => {
      const r = d as { results: ResultItem[]; ok: number; errored: number; skipped: number };
      setResults(r.results);
      toast.success(`Swarm complete: ${r.ok} ok · ${r.errored} errors · ${r.skipped} skipped`);
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 300)),
  });

  const counts = plan
    ? plan.reduce<Record<Action, number>>(
        (acc, p) => ({ ...acc, [p.action]: (acc[p.action] || 0) + 1 }),
        {
          iterative_finish: 0,
          gentle_finish: 0,
          combine: 0,
          vibe_spec: 0,
          skip: 0,
        },
      )
    : null;

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-primary/5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-primary/10">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Swarm — auto-execute this analysis</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Triages every recommendation, then runs the safe ones in parallel.
            Fragile / nearly-done repos get docs-only PRs — never touches src/.
          </p>
        </div>
        {!plan && (
          <Button
            onClick={() => planMut.mutate()}
            disabled={planMut.isPending}
            size="sm"
            className="gap-2"
          >
            {planMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Planning…
              </>
            ) : (
              <>
                <Bot className="h-4 w-4" /> Plan swarm
              </>
            )}
          </Button>
        )}
      </div>

      {plan && counts && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(counts) as Action[])
              .filter((a) => counts[a] > 0)
              .map((a) => {
                const Icon = ACTION_META[a].icon;
                return (
                  <Badge key={a} variant="secondary" className="gap-1">
                    <Icon className={`h-3 w-3 ${ACTION_META[a].color}`} />
                    {counts[a]} × {ACTION_META[a].label}
                  </Badge>
                );
              })}
          </div>

          {summary && (
            <p className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
              {summary}
            </p>
          )}

          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {plan.map((p) => {
              const meta = ACTION_META[p.action];
              const Icon = meta.icon;
              const result = results?.find((r) => r.item_rank === p.item_rank);
              return (
                <div
                  key={p.item_rank}
                  className="flex items-start gap-3 py-2 px-3 rounded border border-border/50 bg-background/50 text-sm"
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">#{p.item_rank} {p.title}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        impact {p.impact}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        fragility {p.fragility}
                      </Badge>
                      {p.fragility >= 60 && p.action !== "skip" && (
                        <span title="Fragile repo — additive-only PR">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      → {meta.label}: {p.reason}
                    </div>
                    {result && (
                      <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                        {result.status === "ok" && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        )}
                        {result.status === "error" && (
                          <XCircle className="h-3 w-3 text-red-500" />
                        )}
                        {result.status === "skipped" && (
                          <SkipForward className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span
                          className={
                            result.status === "error"
                              ? "text-red-500"
                              : result.status === "ok"
                                ? "text-emerald-500"
                                : "text-muted-foreground"
                          }
                        >
                          {result.message}
                        </span>
                        {result.pr_urls?.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                          >
                            PR{i + 1} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                        {result.combined_url && (
                          <a
                            href={result.combined_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                          >
                            repo <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!results && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => execMut.mutate()}
                disabled={execMut.isPending}
                className="gap-2"
              >
                {execMut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running {counts.iterative_finish + counts.gentle_finish + counts.combine + counts.vibe_spec} tasks…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Confirm & execute ({concurrency} in parallel)
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPlan(null);
                  setSwarmRunId(null);
                  setSummary("");
                }}
                disabled={execMut.isPending}
              >
                Cancel
              </Button>
              {execMut.isPending && (
                <span className="text-xs text-muted-foreground">
                  This can take several minutes. Keep this tab open.
                </span>
              )}
            </div>
          )}

          {results && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPlan(null);
                setSwarmRunId(null);
                setResults(null);
                setSummary("");
              }}
            >
              Plan another swarm
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
