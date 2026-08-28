import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type RunStatus =
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale";

type ChangeStatus = "created" | "modified" | "deleted";

interface PreviewChange {
  path: string;
  status: ChangeStatus;
  content: string;
  description: string;
}

interface PreviewResponse {
  runId: string;
  status: "awaiting_approval";
  repo: string;
  defaultBranch: string;
  baseSha: string;
  planHash: string;
  summary: string;
  nextSteps: string[];
  changes: PreviewChange[];
}

interface RunDetailResponse {
  run: {
    id: string;
    repo: string;
    defaultBranch: string;
    baseSha: string;
    planHash: string;
    status: RunStatus;
    approvedAt: string | null;
    branchName: string | null;
    headSha: string | null;
    prNumber: number | null;
    prUrl: string | null;
    ciStatus: string | null;
    error: string | null;
    summary: string;
  };
  steps: Array<{
    id: string;
    ordinal: number;
    title: string;
    description: string;
    status: string;
    error: string | null;
  }>;
  events: Array<{
    id: string;
    kind: string;
    status: "info" | "success" | "warning" | "error";
    message: string;
    created_at: string;
  }>;
  verification: {
    state: "pending" | "passed" | "failed";
    message: string;
    totalChecks: number;
    completedChecks: number;
    failedChecks: number;
  } | null;
}

interface LegacyResult {
  pr_url?: string;
  pr_number?: number;
  summary?: string;
}

interface FinishRepoActionProps {
  repo: string;
  nextSteps?: string[];
  analysisId?: string;
  itemRank?: number;
  initialResult?: LegacyResult | null;
  compact?: boolean;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return customFetch<T>(path, {
    method: "POST",
    responseType: "json",
    body: JSON.stringify(body ?? {}),
  });
}

function statusLabel(status: RunStatus | null) {
  switch (status) {
    case "awaiting_approval": return "Plan ready";
    case "approved": return "Approved";
    case "executing": return "Executing";
    case "verifying": return "Verifying CI";
    case "succeeded": return "Succeeded";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    case "stale": return "Base changed";
    default: return "Not started";
  }
}

function statusClass(status: RunStatus | null) {
  if (status === "succeeded" || status === "approved") return "border-emerald-500/40 text-emerald-600";
  if (status === "failed" || status === "stale") return "border-red-500/40 text-red-600";
  if (status === "executing" || status === "verifying") return "border-blue-500/40 text-blue-600";
  return "border-amber-500/40 text-amber-600";
}

export function FinishRepoAction({ repo, nextSteps, analysisId, itemRank, initialResult, compact = false }: FinishRepoActionProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [busy, setBusy] = useState<"finish" | "approve" | "execute" | "cancel" | "refresh" | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  const runId = detail?.run.id ?? preview?.runId ?? null;
  const status = detail?.run.status ?? preview?.status ?? null;

  const loadRun = useCallback(async (id: string) => {
    const data = await customFetch<RunDetailResponse>(`/api/repo-finisher/runs/${id}`, { responseType: "json" });
    setDetail(data);
    return data;
  }, []);

  const refreshRun = useCallback(async (quiet = false) => {
    if (!runId) return;
    if (!quiet) setBusy("refresh");
    try {
      await loadRun(runId);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to refresh run.");
    } finally {
      if (!quiet) setBusy(null);
    }
  }, [loadRun, runId]);

  useEffect(() => {
    if (!runId || (status !== "executing" && status !== "verifying")) return;
    const timer = window.setInterval(() => void refreshRun(true), 4000);
    return () => window.clearInterval(timer);
  }, [refreshRun, runId, status]);

  const handleOneClickFinish = async () => {
    setBusy("finish");
    setPreview(null);
    setDetail(null);
    setShowPlan(false);
    let createdRunId: string | null = null;

    try {
      const payload: Record<string, unknown> = { repo, nextSteps, analysisId };
      // Historical analysis ranks are zero-based, while the older preview schema
      // accepted only positive ranks. Omit rank zero rather than blocking the top repo.
      if (typeof itemRank === "number" && itemRank > 0) payload.itemRank = itemRank;

      const planned = await postJson<PreviewResponse>("/api/repo-finisher/agentic-preview", payload);
      createdRunId = planned.runId;
      setPreview(planned);

      await postJson(`/api/repo-finisher/runs/${planned.runId}/approve`, { planHash: planned.planHash });
      await postJson(`/api/repo-finisher/runs/${planned.runId}/execute`);
      const latest = await loadRun(planned.runId);

      if (latest.run.status === "succeeded") {
        toast.success(`${repo.split("/")[1]} was finished and verified in a draft PR.`);
      } else if (latest.run.status === "verifying") {
        toast.success(`Autonomous changes are in a draft PR. CI verification is running.`);
      } else {
        toast.success(`Autonomous completion run started for ${repo.split("/")[1]}.`);
      }
    } catch (error) {
      if (createdRunId) await loadRun(createdRunId).catch(() => undefined);
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Autonomous finishing failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (!preview) return;
    setBusy("approve");
    try {
      await postJson(`/api/repo-finisher/runs/${preview.runId}/approve`, { planHash: preview.planHash });
      await loadRun(preview.runId);
      toast.success("Exact plan approved. You can resume execution.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to approve plan.");
    } finally {
      setBusy(null);
    }
  };

  const handleExecute = async () => {
    if (!runId) return;
    setBusy("execute");
    try {
      await postJson(`/api/repo-finisher/runs/${runId}/execute`);
      await loadRun(runId);
      toast.success("Execution resumed; CI verification is enforced.");
    } catch (error) {
      await loadRun(runId).catch(() => undefined);
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Execution failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    setBusy("cancel");
    try {
      await postJson(`/api/repo-finisher/runs/${runId}/cancel`);
      await loadRun(runId);
      toast.success("Completion run cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to cancel run.");
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPreview(null);
    setDetail(null);
    setShowPlan(false);
  };

  const currentSummary = detail?.run.summary ?? preview?.summary;
  const baseSha = detail?.run.baseSha ?? preview?.baseSha;
  const planHash = detail?.run.planHash ?? preview?.planHash;

  return (
    <div className="space-y-3">
      {initialResult?.pr_url && !runId && (
        <Card className="p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Previous completion result</span>
            <a href={initialResult.pr_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-500 hover:underline flex items-center gap-1">
              PR {initialResult.pr_number ? `#${initialResult.pr_number}` : ""} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {initialResult.summary && <p className="text-xs text-muted-foreground">{initialResult.summary}</p>}
        </Card>
      )}

      {!runId && (
        <div className={compact ? "" : "rounded-lg border border-primary/20 bg-primary/5 p-3"}>
          <Button
            onClick={handleOneClickFinish}
            disabled={busy !== null}
            className="gap-2"
            size={compact ? "sm" : "default"}
            data-testid={`button-finish-${repo}`}
          >
            {busy === "finish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {busy === "finish" ? `Finishing ${repo.split("/")[1]}…` : "Finish repository"}
          </Button>
          {!compact && (
            <p className="mt-2 text-xs text-muted-foreground">
              One click runs the agent council, generates an exact plan, records your approval for that generated hash, creates a draft PR, and verifies CI.
            </p>
          )}
        </div>
      )}

      {runId && (
        <Card className="p-4 space-y-4 border-primary/20">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-semibold">Autonomous completion run</span>
            <Badge variant="outline" className={`ml-auto ${statusClass(status)}`}>{statusLabel(status)}</Badge>
          </div>

          {currentSummary && <p className="text-sm text-muted-foreground">{currentSummary}</p>}

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Pinned base commit</div>
              <code>{baseSha?.slice(0, 12)}</code>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Exact plan hash</div>
              <code>{planHash?.slice(0, 16)}…</code>
            </div>
          </div>

          {preview && (
            <div className="space-y-2">
              <button onClick={() => setShowPlan((value) => !value)} className="text-sm font-medium flex items-center gap-1 hover:underline">
                <FileCode className="h-3.5 w-3.5" />
                {showPlan ? "Hide" : "Inspect"} exact plan ({preview.changes.length} files)
              </button>
              {showPlan && (
                <div className="space-y-2">
                  {preview.changes.map((change) => (
                    <details key={change.path} className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm break-all">
                        <code>{change.status === "created" ? "+" : change.status === "modified" ? "~" : "-"} {change.path}</code>
                        <span className="ml-2 text-xs text-muted-foreground">{change.description}</span>
                      </summary>
                      {change.status !== "deleted" && (
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">{change.content}</pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

          {detail?.run.error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 p-3 text-sm text-red-600">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-words">{detail.run.error}</span>
            </div>
          )}

          {detail?.verification && (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">CI verification: {detail.verification.state}</div>
              <div className="text-xs text-muted-foreground">{detail.verification.message}</div>
            </div>
          )}

          {status === "awaiting_approval" && preview && busy === null && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleApprove} size="sm" className="gap-2">
                <ShieldCheck className="h-4 w-4" /> Resume approval
              </Button>
              <Button variant="outline" onClick={handleCancel} size="sm">Cancel</Button>
            </div>
          )}

          {status === "approved" && busy === null && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleExecute} size="sm" className="gap-2">
                <Rocket className="h-4 w-4" /> Resume execution
              </Button>
              <Button variant="outline" onClick={handleCancel} size="sm">Cancel</Button>
            </div>
          )}

          {(busy === "finish" || status === "executing" || status === "verifying") && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "verifying" ? "Waiting for required checks…" : "Autonomous agents are finishing the repository…"}
            </div>
          )}

          {status === "succeeded" && detail?.run.prUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-sm font-medium">Verified successfully</span>
              <a href={detail.run.prUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm text-blue-500 hover:underline flex items-center gap-1">
                View draft PR #{detail.run.prNumber} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {status === "stale" && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                Repository base changed after the plan was generated. Execution was blocked.
              </div>
              <Button variant="outline" size="sm" onClick={reset}>Re-plan from current base</Button>
            </div>
          )}

          {(status === "failed" || status === "cancelled") && (
            <Button variant="outline" size="sm" onClick={reset}>Start a new autonomous run</Button>
          )}

          {runId && status !== "executing" && status !== "verifying" && busy === null && (
            <Button variant="ghost" size="sm" onClick={() => void refreshRun()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh status
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
