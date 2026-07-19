import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  planSequence,
  executeSequence,
  getSequencerRun,
  listSequencerRuns,
} from "@/lib/step-sequencer.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ListOrdered,
  Play,
  Eye,
  CheckCircle2,
  XCircle,
  SkipForward,
  CircleDot,
  Clock,
  AlertTriangle,
  GitBranch,
  ExternalLink,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface StepSequencerProps {
  repo: string;
}

export function StepSequencer({ repo }: StepSequencerProps) {
  const planFn = useServerFn(planSequence);
  const executeFn = useServerFn(executeSequence);
  const listFn = useServerFn(listSequencerRuns);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [skipCI, setSkipCI] = useState(false);

  // List recent runs for this repo
  const runsQuery = useQuery({
    queryKey: ["sequencer-runs", repo],
    queryFn: () => listFn({ data: { repo } }),
    refetchInterval: 10000,
  });

  // Plan mutation
  const planMut = useMutation({
    mutationFn: () => planFn({ data: { repo } }),
    onSuccess: (data) => {
      const d = data as { runId: string; plan: { totalSteps: number; strategy: string } };
      setActiveRunId(d.runId);
      setShowPlan(true);
      toast.success(`Planned ${d.plan.totalSteps} steps for ${repo.split("/").pop()}`);
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  // Execute mutation
  const executeMut = useMutation({
    mutationFn: (runId: string) =>
      executeFn({ data: { runId, stopOnCIFailure: true, skipCICheck: skipCI } }),
    onSuccess: (data) => {
      const d = data as {
        status: string;
        stepsCompleted: number;
        stepsFailed: number;
        prUrl: string | null;
      };
      if (d.status === "completed") {
        toast.success(`All ${d.stepsCompleted} steps completed!`);
      } else if (d.status === "stopped_on_failure") {
        toast.error(
          `Stopped at step failure. ${d.stepsCompleted} passed, ${d.stepsFailed} failed.`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });

  // Current run data
  const activeRun = executeMut.data as {
    runId: string;
    status: string;
    stepsCompleted: number;
    stepsFailed: number;
    prUrl: string | null;
    prNumber: number | null;
    plan: {
      repo: string;
      totalSteps: number;
      strategy: string;
      estimatedMinutes: number;
      deepAnalysisUsed: boolean;
      steps: Array<{
        number: number;
        title: string;
        description: string;
        status: string;
        files: Array<{ path: string; action: string }>;
        prUrl: string | null;
        ciResult: { status: string; summary: string } | null;
        error: string | null;
        durationMs: number;
      }>;
    };
  } | null;

  const planData = planMut.data as {
    runId: string;
    plan: {
      totalSteps: number;
      strategy: string;
      estimatedMinutes: number;
      deepAnalysisUsed: boolean;
      steps: Array<{
        number: number;
        title: string;
        description: string;
        files: Array<{ path: string; action: string }>;
      }>;
    };
  } | null;

  const displayPlan = activeRun?.plan ?? planData?.plan;
  const displayRunId = activeRun?.runId ?? planData?.runId;

  function statusIcon(status: string) {
    switch (status) {
      case "ci_passed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "ci_failed":
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "skipped":
        return <SkipForward className="h-4 w-4 text-gray-400" />;
      case "running":
      case "ci_checking":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "committed":
        return <GitBranch className="h-4 w-4 text-blue-500" />;
      default:
        return <CircleDot className="h-4 w-4 text-gray-300" />;
    }
  }

  function statusBadge(status: string) {
    const variants: Record<string, string> = {
      ci_passed: "bg-green-500/10 text-green-500 border-green-500/30",
      ci_failed: "bg-red-500/10 text-red-500 border-red-500/30",
      failed: "bg-red-500/10 text-red-500 border-red-500/30",
      skipped: "bg-gray-500/10 text-gray-400 border-gray-500/30",
      running: "bg-blue-500/10 text-blue-500 border-blue-500/30",
      ci_checking: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
      committed: "bg-blue-500/10 text-blue-500 border-blue-500/30",
      pending: "bg-gray-500/10 text-gray-400 border-gray-500/30",
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded border ${variants[status] ?? variants.pending}`}>
        {status.replace(/_/g, " ")}
      </span>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5 text-primary" />
          <h3 className="font-mono text-sm font-semibold">step sequencer</h3>
          <Badge variant="outline" className="text-xs">
            <Shield className="h-3 w-3 mr-1" />
            CI verified
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={skipCI}
              onChange={(e) => setSkipCI(e.target.checked)}
              className="h-3 w-3"
            />
            skip CI
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => planMut.mutate()}
            disabled={planMut.isPending || executeMut.isPending}
          >
            {planMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Eye className="h-3 w-3 mr-1" />
            )}
            Plan Steps
          </Button>
          {displayRunId && !activeRun && (
            <Button
              size="sm"
              onClick={() => executeMut.mutate(displayRunId)}
              disabled={executeMut.isPending}
            >
              {executeMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              Execute
            </Button>
          )}
        </div>
      </div>

      {/* Plan / execution view */}
      {displayPlan && (
        <div className="space-y-3">
          {/* Strategy header */}
          <div className="bg-muted/50 rounded-md p-3">
            <p className="text-xs text-muted-foreground font-mono mb-1">
              // strategy ({displayPlan.totalSteps} steps, ~{displayPlan.estimatedMinutes}min)
              {displayPlan.deepAnalysisUsed && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  deep analysis â
                </Badge>
              )}
            </p>
            <p className="text-sm">{displayPlan.strategy}</p>
          </div>

          {/* PR link */}
          {activeRun?.prUrl && (
            <a
              href={activeRun.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <GitBranch className="h-3 w-3" />
              PR #{activeRun.prNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {/* Step list */}
          <div className="space-y-2">
            {displayPlan.steps.map((step) => (
              <div
                key={step.number}
                className={`border rounded-md p-3 ${
                  (step as { status?: string }).status === "ci_failed" || (step as { status?: string }).status === "failed"
                    ? "border-red-500/30 bg-red-500/5"
                    : (step as { status?: string }).status === "ci_passed"
                      ? "border-green-500/30 bg-green-500/5"
                      : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs text-muted-foreground font-mono mt-0.5">
                    {step.number}.
                  </span>
                  {statusIcon((step as { status?: string }).status ?? "pending")}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{step.title}</span>
                      {(step as { status?: string }).status &&
                        statusBadge((step as { status?: string }).status ?? "pending")}
                      {(step as { durationMs?: number }).durationMs ? (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {Math.round(((step as { durationMs?: number }).durationMs ?? 0) / 1000)}s
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {step.files.map((f) => (
                        <span
                          key={f.path}
                          className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                            f.action === "create"
                              ? "bg-green-500/10 text-green-600"
                              : f.action === "delete"
                                ? "bg-red-500/10 text-red-600"
                                : "bg-blue-500/10 text-blue-600"
                          }`}
                        >
                          {f.action === "create" ? "+" : f.action === "delete" ? "-" : "~"}{" "}
                          {f.path}
                        </span>
                      ))}
                    </div>
                    {/* CI result */}
                    {(step as { ciResult?: { status: string; summary: string } | null }).ciResult && (
                      <p className="text-[10px] mt-1 text-muted-foreground">
                        CI: {(step as { ciResult: { summary: string } }).ciResult.summary.slice(0, 150)}
                      </p>
                    )}
                    {/* Error */}
                    {(step as { error?: string | null }).error && (
                      <div className="flex items-start gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-[10px] text-red-500">
                          {(step as { error: string }).error.slice(0, 200)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          {activeRun && (
            <div className="bg-muted/50 rounded-md p-3 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-green-500">{activeRun.stepsCompleted} passed</span>
                {activeRun.stepsFailed > 0 && (
                  <span className="text-red-500 ml-2">{activeRun.stepsFailed} failed</span>
                )}
                <span className="text-muted-foreground ml-2">
                  / {displayPlan.totalSteps} total
                </span>
              </div>
              {statusBadge(activeRun.status)}
            </div>
          )}
        </div>
      )}

      {/* Previous runs */}
      {runsQuery.data && (runsQuery.data as { runs: unknown[] }).runs.length > 0 && !displayPlan && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-mono">// previous runs</p>
          {((runsQuery.data as { runs: Array<{
            id: string;
            status: string;
            steps_completed: number;
            steps_failed: number;
            created_at: string;
          }> }).runs).slice(0, 5).map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between text-xs py-1 border-b border-border/50"
            >
              <span className="text-muted-foreground">
                {new Date(run.created_at).toLocaleDateString()}
              </span>
              <span>
                {run.steps_completed}/{run.steps_completed + run.steps_failed} steps
              </span>
              {statusBadge(run.status)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
