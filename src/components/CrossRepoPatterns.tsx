import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCrossRepoPatterns } from "@/lib/learning-log.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, TrendingDown, Minus } from "lucide-react";

export function CrossRepoPatterns() {
  const fn = useServerFn(getCrossRepoPatterns);
  const q = useQuery({
    queryKey: ["cross-repo-patterns"],
    queryFn: () => fn({}),
  });

  if (q.isLoading || !q.data || q.data.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="font-mono text-sm text-muted-foreground mb-4 flex items-center gap-2">
        <Brain className="h-4 w-4" />
        // cross-repo patterns
      </h2>
      <div className="space-y-3">
        {q.data.map((pattern, i) => (
          <div key={i} className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {pattern.confidence >= 70 ? (
                  <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                ) : pattern.confidence <= 30 ? (
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                ) : (
                  <Minus className="h-3.5 w-3.5 text-yellow-500" />
                )}
                <span className="text-sm font-medium">{pattern.pattern}</span>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] font-mono shrink-0 ${
                  pattern.confidence >= 70
                    ? "text-green-500 border-green-500/30"
                    : pattern.confidence <= 30
                      ? "text-red-500 border-red-500/30"
                      : "text-yellow-500 border-yellow-500/30"
                }`}
              >
                {pattern.confidence}% success
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{pattern.recommendation}</p>
            <div className="flex flex-wrap gap-1">
              {pattern.occurrences.slice(-5).map((occ, j) => (
                <Badge key={j} variant="secondary" className="text-[9px] font-mono">
                  {occ.repo.split("/").pop()} · {occ.outcome}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
