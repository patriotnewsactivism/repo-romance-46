import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { generateActionPlan } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Rocket, GitBranch, Target, Calendar } from "lucide-react";
import { toast } from "sonner";

interface ActionPlanData {
  total_weeks: number;
  phases: {
    name: string;
    duration_weeks: number;
    items: {
      title: string;
      recommendation_index: number;
      why_now: string;
      key_deliverable: string;
    }[];
  }[];
  quick_wins: string[];
  moonshots: string[];
  dependencies: { from_title: string; to_title: string; reason: string }[];
}

export function ActionPlan({ analysisId }: { analysisId: string }) {
  const [plan, setPlan] = useState<ActionPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => generateActionPlan(analysisId),
    onSuccess: (data) => {
      setPlan(data as unknown as ActionPlanData);
      setError(null);
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error(e.message);
    },
  });

  if (!plan && !mut.isPending && !error) {
    return (
      <Card className="p-6 text-center space-y-4">
        <Target className="h-10 w-10 mx-auto text-primary" />
        <div>
          <h3 className="font-semibold">Generate an Action Plan</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Turn your recommendations into a sequenced execution roadmap with phases, quick wins,
            and dependency mapping.
          </p>
        </div>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="glow-primary">
          <Target className="h-4 w-4 mr-2" /> Generate action plan
        </Button>
      </Card>
    );
  }

  if (mut.isPending) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
        <p className="mt-3 text-sm text-muted-foreground font-mono">
          AI is sequencing your roadmap…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 border-destructive/50">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => mut.mutate()}>
          Try again
        </Button>
      </Card>
    );
  }

  if (!plan) return null;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <span className="font-mono font-semibold">~{plan.total_weeks} weeks total</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {plan.phases.length} phases · {plan.quick_wins.length} quick wins ·{" "}
            {plan.moonshots.length} moonshots
          </div>
        </div>
      </Card>

      {/* Quick Wins + Moonshots */}
      <div className="grid gap-4 md:grid-cols-2">
        {plan.quick_wins.length > 0 && (
          <Card className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm font-semibold">Quick wins (&lt;1 week)</h3>
            </div>
            <ul className="space-y-1 text-sm">
              {plan.quick_wins.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">▸</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {plan.moonshots.length > 0 && (
          <Card className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm font-semibold">Moonshots (highest reward)</h3>
            </div>
            <ul className="space-y-1 text-sm">
              {plan.moonshots.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">▸</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {plan.phases.map((phase, i) => (
          <Card key={i} className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary font-mono text-xs font-bold">
                  {i + 1}
                </span>
                <h3 className="font-mono font-semibold">{phase.name}</h3>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                ~{phase.duration_weeks}w
              </span>
            </div>
            <div className="space-y-2">
              {phase.items.map((item, j) => (
                <div key={j} className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{item.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono text-primary">why now:</span> {item.why_now}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono text-primary">deliverable:</span>{" "}
                    {item.key_deliverable}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Dependencies */}
      {plan.dependencies.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-mono text-sm font-semibold">Dependencies</h3>
          </div>
          <div className="space-y-2">
            {plan.dependencies.map((dep, i) => (
              <div key={i} className="text-sm">
                <span className="font-mono text-xs">{dep.from_title}</span>
                <span className="text-muted-foreground mx-2">→</span>
                <span className="font-mono text-xs">{dep.to_title}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{dep.reason}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
