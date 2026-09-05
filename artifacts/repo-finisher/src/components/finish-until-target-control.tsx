import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Repeat2, ShieldCheck, Square } from "lucide-react";
import { toast } from "sonner";

interface FinishSession {
  id: string;
  repo: string;
  status: "active" | "succeeded" | "blocked" | "budget_exhausted" | "cancelled";
  phase: string;
  target_completion_pct: number;
  target_readiness_pct: number;
  max_iterations: number;
  iteration_count: number;
  last_completion_pct: number | null;
  last_readiness_pct: number | null;
  stop_reason: string | null;
  branch_name: string | null;
  pr_url: string | null;
}

interface CreateResponse {
  session: FinishSession;
  baseline: { completionPct: number; productionReadinessPct: number };
  scheduled: boolean;
  workerMode: string | null;
  automaticMerge: false;
}

interface DetailResponse {
  session: FinishSession;
  iterations: Array<{
    id: string;
    status: string;
    session_iteration: number;
    pr_url: string | null;
    ci_status: string | null;
    outcome_score: number | null;
    error: string | null;
  }>;
  events: Array<{ id: string; status: string; message: string; created_at: string }>;
  automaticMerge: false;
}

async function postJson<T>(path: string, body?: unknown) {
  return customFetch<T>(path, { method: "POST", responseType: "json", body: JSON.stringify(body ?? {}) });
}

export function FinishUntilTargetControl({
  repo,
  analysisId,
  itemRank,
  nextSteps = [],
}: {
  repo: string;
  analysisId: string;
  itemRank?: number;
  nextSteps?: string[];
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [busy, setBusy] = useState<"create" | "refresh" | "cancel" | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (sessionId: string, quiet = false) => {
    if (!quiet) setBusy("refresh");
    try {
      const result = await customFetch<DetailResponse>(`/api/repo-finisher/completion-sessions/${sessionId}`, { responseType: "json" });
      setDetail(result);
      return result;
    } finally {
      if (!quiet) setBusy(null);
    }
  }, []);

  useEffect(() => {
    const session = detail?.session;
    if (!session || session.status !== "active") return;
    const timer = window.setInterval(() => void load(session.id, true).catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [detail?.session?.id, detail?.session?.status, load]);

  const start = async () => {
    setBusy("create");
    try {
      const payload: Record<string, unknown> = {
        repo,
        analysisId,
        nextSteps,
        targetCompletionPct: 95,
        targetReadinessPct: 90,
        maxIterations: 5,
        maxNoProgressIterations: 2,
        boundedAutonomyAcknowledged: true,
      };
      if (typeof itemRank === "number") payload.itemRank = itemRank;
      const result = await postJson<CreateResponse>("/api/repo-finisher/completion-sessions", payload);
      const loaded = await load(result.session.id, true);
      setDetail(loaded);
      setExpanded(true);
      if (result.session.status === "succeeded") {
        toast.success("Repository already meets the requested finish targets.");
      } else {
        toast.success(`Finish-until-target started using ${result.workerMode || "the configured worker"}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to start finish-until-target.");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!detail?.session.id) return;
    setBusy("cancel");
    try {
      await postJson(`/api/repo-finisher/completion-sessions/${detail.session.id}/cancel`);
      await load(detail.session.id, true);
      toast.success("Finish-until-target stopped. The draft branch/PR was preserved for inspection.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to cancel session.");
    } finally {
      setBusy(null);
    }
  };

  if (!detail) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><Repeat2 className="h-4 w-4 text-emerald-500" /> Finish until target</div>
        <p className="text-xs text-muted-foreground">
          This is the path that actually finishes a repo: iterate from fresh evidence until 95% completion and 90% production readiness, or a safety/no-progress/budget stop. Up to 5 iterations; one draft PR; automatic merge stays off. Requires Investment Intelligence scores (usually auto-generated after analysis).
        </p>
        <Button size="sm" variant="outline" className="gap-2" onClick={start} disabled={busy !== null}>
          {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Start finish-until-target
        </Button>
      </div>
    );
  }

  const session = detail.session;
  const terminal = session.status !== "active";
  const completion = session.last_completion_pct ?? 0;
  const readiness = session.last_readiness_pct ?? 0;

  return (
    <Card className="p-3 space-y-3 border-emerald-500/20">
      <button className="w-full text-left" onClick={() => setExpanded((value) => !value)}>
        <div className="flex flex-wrap items-center gap-2">
          {session.status === "active" ? <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          <span className="text-sm font-semibold">Finish-until-target</span>
          <Badge variant="outline">{session.status}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">iteration {session.iteration_count}/{session.max_iterations}</span>
        </div>
      </button>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border p-2"><span className="text-muted-foreground">Completion</span><div className="font-semibold">{Math.round(completion)}% / {session.target_completion_pct}%</div></div>
        <div className="rounded border p-2"><span className="text-muted-foreground">Readiness</span><div className="font-semibold">{Math.round(readiness)}% / {session.target_readiness_pct}%</div></div>
      </div>
      {expanded && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Phase: {session.phase}. Each iteration re-assesses, plans against the current base, verifies CI/runtime evidence where available, re-scores, and stops rather than guessing when progress or safety criteria fail.</p>
          {session.stop_reason && <div className="rounded border p-2 text-xs"><span className="font-medium">Stop reason:</span> {session.stop_reason}</div>}
          {detail.iterations.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase text-muted-foreground">Iterations</div>
              {detail.iterations.map((iteration) => (
                <div key={iteration.id} className="rounded border p-2 text-xs flex flex-wrap gap-2 items-center">
                  <span>#{iteration.session_iteration}</span><Badge variant="outline">{iteration.status}</Badge>
                  {iteration.ci_status && <span className="text-muted-foreground">CI {iteration.ci_status}</span>}
                  {typeof iteration.outcome_score === "number" && <span className="text-muted-foreground">outcome {Math.round(iteration.outcome_score)}</span>}
                  {iteration.pr_url && <a href={iteration.pr_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-500 hover:underline flex items-center gap-1">PR <ExternalLink className="h-3 w-3" /></a>}
                  {iteration.error && <span className="w-full text-red-500">{iteration.error}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" className="gap-2" onClick={() => void load(session.id)} disabled={busy !== null}>
              {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
            {!terminal && <Button size="sm" variant="outline" className="gap-2" onClick={cancel} disabled={busy !== null}><Square className="h-3.5 w-3.5" /> Stop safely</Button>}
            {session.pr_url && <a href={session.pr_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline">Open draft PR <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </div>
      )}
    </Card>
  );
}
