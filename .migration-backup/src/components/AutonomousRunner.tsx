import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  previewAutonomousPlan,
  runAutonomousNow,
  getJobStatus,
  getJobHistory,
  enqueueJob,
} from "@/lib/autonomous-runner.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Brain,
  Play,
  Eye,
  Clock,
  CheckCircle2,
  XCircle,
  Zap,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";
import { Skeleton } from "@/components/ui/skeleton";

// Error handling utility
const handleError = (error: unknown, defaultMessage: string) => {
  if (error instanceof Error) {
    toast.error(error.message || defaultMessage);
    console.error(error);
  } else {
    toast.error(defaultMessage);
    console.error('Unknown error:', error);
  }
};

// Loading state component
const LoadingState = () => (
  <div className="space-y-2">
    <Skeleton className="h-4 w-[200px]" />
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex items-start gap-3 rounded-md border border-border p-3">
        <Skeleton className="h-4 w-4 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-[150px]" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    ))}
  </div>
);

// Error state component
const ErrorState = ({ message }: { message: string }) => (
  <div className="flex items-center gap-2 p-3 rounded-md border border-destructive/50 bg-destructive/10">
    <XCircle className="h-4 w-4 text-destructive" />
    <p className="text-sm text-destructive">{message}</p>
  </div>
);

// Main component
export function AutonomousRunner() {
  const previewFn = useServerFn(previewAutonomousPlan);
  const runFn = useServerFn(runAutonomousNow);
  const statusFn = useServerFn(getJobStatus);
  const historyFn = useServerFn(getJobHistory);
  const enqueueFn = useServerFn(enqueueJob);
  const [showHistory, setShowHistory] = useState(false);

  const previewMut = useMutation({
    mutationFn: () => previewFn({}),
    onError: (e: Error) => handleError(e, "Failed to preview autonomous plan"),
  });

  const runMut = useMutation({
    mutationFn: () => runFn({}),
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.success).length;
      const fail = res.results.filter((r) => !r.success).length;
      toast.success(`Autonomous run complete: ${ok} succeeded, ${fail} failed`);
      activeQ.refetch();
    },
    onError: (e: Error) => handleError(e, "Failed to run autonomous tasks"),
  });

  const activeQ = useQuery({
    queryKey: ["active-jobs"],
    queryFn: () => statusFn({ data: {} }),    
    refetchInterval: 5000,
    onError: (e: Error) => handleError(e, "Failed to fetch active jobs"),
  });

  const historyQ = useQuery({
    queryKey: ["job-history"],
    queryFn: () => historyFn({}),
    enabled: showHistory,
    onError: (e: Error) => handleError(e, "Failed to fetch job history"),
  });

  const activeJobs = (activeQ.data?.jobs ?? []) as Array<{
    id: string;
    kind: string;
    repo: string | null;
    status: string;
    priority: number;
    created_at: string;
    context: Record<string, unknown>;
  }>;

  const historyJobs = (historyQ.data?.jobs ?? []) as Array<{
    id: string;
    kind: string;
    repo: string | null;
    status: string;
    result: Record<string, unknown> | null;
    error: string | null;
    completed_at: string;
  }>;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm text-muted-foreground flex items-center gap-2">
          <Brain className="h-4 w-4" />
          // autonomous runner
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending}
          >
            {previewMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Eye className="h-3.5 w-3.5 mr-1.5" />
            )}
            Preview Plan
          </Button>
          <Button
            size="sm"
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="bg-primary"
          >
            {runMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            Run Now
          </Button>
        </div>
      </div>

      {/* Preview: what the AI would do */}
      {previewMut.isPending ? (
        <LoadingState />
      ) : previewMut.isError ? (
        <ErrorState message="Failed to load preview" />
      ) : previewMut.data ? (
        <div className="space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase">
            AI Reasoning — Planned Actions
          </div>
          {previewMut.data.decisions.map((d, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div className="shrink-0">
                {d.action === "skip" || d.action === "wait" ? (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Zap className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {d.action}
                  </Badge>
                  {d.repo && (
                    <span className="text-xs text-muted-foreground font-mono">{d.repo}</span>
                  )}
                  <Badge
                    variant="secondary"
                    className="text-[9px] font-mono ml-auto"
                  >
                    priority {d.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{d.reasoning}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Run results */}
      {runMut.isPending ? (
        <LoadingState />
      ) : runMut.isError ? (
        <ErrorState message="Failed to execute run" />
      ) : runMut.data ? (
        <div className="space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase">
            Run Results
          </div>
          {runMut.data.results.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs rounded-md border border-border p-2"
            >
              {r.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {r.action}
                  </Badge>
                  {r.repo && (
                    <span className="font-mono text-muted-foreground">{r.repo}</span>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5">{r.summary.slice(0, 150)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Active background jobs */}
      {activeQ.isPending ? (
        <LoadingState />
      ) : activeQ.isError ? (
        <ErrorState message="Failed to load active jobs" />
      ) : activeJobs.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-mono text-muted-foreground uppercase">Active Jobs</div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1"
              onClick={() => activeQ.refetch()}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          {activeJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-2 text-xs font-mono rounded border border-border px-2 py-1.5"
            >
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
              <Badge variant="outline" className="text-[9px]">
                {job.kind}
              </Badge>
              <span className="text-muted-foreground truncate">{job.repo || "portfolio"}</span>
              <Badge variant="secondary" className="text-[9px] ml-auto">
                {job.status}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}

      {/* Toggle history */}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
        >
          {showHistory ? "▾ hide job history" : "▸ show job history"}
        </button>
      </div>

      {showHistory && (
        historyQ.isPending ? (
          <LoadingState />
        ) : historyQ.isError ? (
          <ErrorState message="Failed to load job history" />
        ) : historyJobs.length > 0 ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {historyJobs.slice(0, 20).map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground"
              >
                {job.status === "complete" ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                )}
                <span>{job.kind}</span>
                <span className="text-muted-foreground/60">{job.repo || "portfolio"}</span>
                {job.error && <span className="text-red-400 truncate">{job.error.slice(0, 50)}</span>}
                <span className="ml-auto text-muted-foreground/40">
                  {job.completed_at
                    ? new Date(job.completed_at).toLocaleDateString()
                    : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No job history available</p>
        )
      )}
    </Card>
  );
}