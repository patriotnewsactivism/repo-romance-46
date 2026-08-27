import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileCode,
  Loader2,
  RefreshCw,
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
    case "awaiting_approval": return "Awaiting approval";
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

export function FinishRepoAction({ repo, nextSteps, analysisId, itemRank, initialResult }: FinishRepoActionProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "approve" | "execute" | "cancel" | "refresh" | null>(null);
  const [showPlan, setShowPlan] = useState(true);

  const runId = detail?.run.id ?? preview?.runId ?? null;
  const status = detail?.run.status ?? preview?.status ?? null;

  const refreshRun = useCallback(async (quiet = false) => {
    if (!runId) return;
    if (!quiet) setBusy("refresh");
    try {
      const data = await customFetch<RunDetailResponse>(`/api/repo-finisher/runs/${runId}`, { responseType: "json" });
      setDetail(data);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to refresh run.");
    } finally {
      if (!quiet) setBusy(null);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId || (status !== "executing" && status !== "verifying")) return;
    const timer = window.setInterval(() => void refreshRun(true), 4000);
    return () => window.clearInterval(timer);
  }, [refreshRun, runId, status]);

  const handlePreview = async () => {
    setBusy("preview");
    setPreview(null);
    setDetail(null);
    setShowPlan(true);
    try {
      const data = await postJson<PreviewResponse>("/api/repo-finisher/preview", {
        repo,
        nextSteps,
        analysisId,
        itemRank,
      });
      setPreview(data);
      toast.success(`Prepared ${data.changes.length} exact change${data.changes.length === 1 ? "" : "s"} for review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to prepare completion plan.");
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (!preview) return;
    setBusy("approve");
    try {
      await postJson(`/api/repo-finisher/runs/${preview.runId}/approve`, { planHash: preview.planHash });
      await refreshRun(true);
      toast.success("Exact plan approved. No repository changes have been made yet.");
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
      await refreshRun(true);
      toast.success("Approved plan executed into a draft PR. CI verification is enforced.");
    } catch (error) {
      await refreshRun(true);
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
      await refreshRun(true);
      toast.success("Completion run cancelled before execution.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Unable to cancel run.");
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPreview(null);
    setDetail(null);
    setShowPlan(true);
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
        <Button onClick={handlePreview} disabled={busy !== null} className="gap-2" size="sm" data-testid={`button-finish-${repo}`}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          {busy === "preview" ? `Planning ${repo.split("/")[1]}...` : "Preview completion plan"}
        </Button>
      )}

      {runId && (
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-semibold">Approval-bound completion run</span>
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
                      <summary className="cursor-pointer text-sm">
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
              <XCircle className="h-4 w-4 mt-0.5" />
              <span>{detail.run.error}</span>
            </div>
          )}

          {detail?.verification && (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">CI verification: {detail.verification.state}</div>
              <div className="text-xs text-muted-foreground">{detail.verification.message}</div>
            </div>
          )}

          {status === "awaiting_approval" && preview && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleApprove} disabled={busy !== null} size="sm" className="gap-2">
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Approve exact plan
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={busy !== null} size="sm">Cancel</Button>
            </div>
          )}

          {status === "approved" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleExecute} disabled={busy !== null} size="sm" className="gap-2">
                {busy === "execute" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Execute approved plan
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={busy !== null} size="sm">Cancel</Button>
            </div>
          )}

          {(status === "executing" || status === "verifying") && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "executing" ? "Creating the approved atomic commit and draft PR…" : "Waiting for required checks…"}
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
                Repository base changed after approval. Execution was blocked.
              </div>
              <Button variant="outline" size="sm" onClick={reset}>Re-plan from current base</Button>
            </div>
          )}

          {(status === "failed" || status === "cancelled") && (
            <Button variant="outline" size="sm" onClick={reset}>Start a new plan</Button>
          )}

          {runId && status !== "executing" && status !== "verifying" && (
            <Button variant="ghost" size="sm" onClick={() => void refreshRun()} disabled={busy !== null} className="gap-2">
              {busy === "refresh" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh status
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
