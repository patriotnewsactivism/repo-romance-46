import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getRepoHealth } from "@/lib/github.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  B: "bg-lime-500/20 text-lime-400 border-lime-500/30",
  C: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  D: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  F: "bg-destructive/20 text-destructive border-destructive/30",
};

export function RepoHealthCheck({
  repo,
  defaultOpen = false,
}: {
  repo: string;
  defaultOpen?: boolean;
}) {
  const fn = useServerFn(getRepoHealth);
  const [open, setOpen] = useState(defaultOpen);

  type HealthData = {
    repo: string;
    healthScore: number;
    grade: string;
    factors: { name: string; status: boolean; weight: number }[];
    ciProvider: string | null;
    license: string | null;
    hasTests: boolean;
    hasCI: boolean;
    stars: number;
    openIssues: number;
    lastPush: string;
  };
  const q = useQuery<HealthData>({
    queryKey: ["repo-health", repo],
    queryFn: () => fn({ data: { repo } }) as Promise<HealthData>,
    enabled: open,
  });

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-mono text-muted-foreground hover:text-foreground"
      >
        {open ? "▾ hide health check" : "▸ show health check"}
      </button>
      {open && (
        <div className="mt-3">
          {q.isLoading && (
            <p className="text-xs text-muted-foreground font-mono">checking health…</p>
          )}
          {q.isError && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
          {q.data && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full border font-mono text-lg font-bold",
                    GRADE_COLORS[q.data.grade],
                  )}
                >
                  {q.data.grade}
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold">{q.data.healthScore}/100</div>
                  <div className="text-xs text-muted-foreground">health score</div>
                </div>
              </div>
              <div className="space-y-1">
                {q.data.factors.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {f.status ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className={f.status ? "text-foreground" : "text-muted-foreground"}>
                      {f.name}
                    </span>
                    <span className="text-muted-foreground font-mono ml-auto">+{f.weight}</span>
                  </div>
                ))}
              </div>
              {(q.data.ciProvider || q.data.license) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {q.data.ciProvider && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      CI: {q.data.ciProvider}
                    </Badge>
                  )}
                  {q.data.license && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      License: {q.data.license}
                    </Badge>
                  )}
                  {q.data.hasTests && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      Tests
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
