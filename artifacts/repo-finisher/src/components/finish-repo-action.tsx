import { useMemo, useState } from "react";
import {
  useExecuteRepoPlan,
  usePlanRepoChanges,
  type ExecuteResult,
  type PlanResponse,
  type PlannedChange,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode,
  GitBranch,
  Loader2,
  Rocket,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

interface FinishRepoActionProps {
  repo: string;
  nextSteps?: string[];
  analysisId?: string;
  itemRank?: number;
  /** Previously persisted result, if this repo/recommendation was already finished. */
  initialResult?: ExecuteResult | null;
}

const STATUS_GLYPH: Record<PlannedChange["status"], string> = {
  created: "+",
  modified: "~",
  deleted: "-",
};

const STATUS_CLASS: Record<PlannedChange["status"], string> = {
  created: "text-emerald-500 font-mono text-xs",
  modified: "text-yellow-500 font-mono text-xs",
  deleted: "text-red-500 font-mono text-xs",
};

/**
 * Two-step repository change flow.
 *
 * The previous version had one button that asked an AI for file contents and
 * committed them immediately. Now the user sees every proposed file, ticks the
 * ones they want, and separately consents to anything touching CI, containers,
 * manifests, lockfiles, auth or migrations. Only ticked paths are ever written,
 * and the server re-verifies the whole approval before it touches the repo.
 */
export function FinishRepoAction({ repo, nextSteps, analysisId, itemRank, initialResult }: FinishRepoActionProps) {
  const [proposal, setProposal] = useState<PlanResponse | null>(null);
  const [approvedPaths, setApprovedPaths] = useState<Set<string>>(new Set());
  const [highRiskConsent, setHighRiskConsent] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(initialResult ?? null);

  const planChanges = usePlanRepoChanges();
  const executePlan = useExecuteRepoPlan();

  const highRiskSelected = useMemo(() => {
    if (!proposal) return [];
    return proposal.plan.changes.filter((c) => c.risk === "high" && approvedPaths.has(c.path)).map((c) => c.path);
  }, [proposal, approvedPaths]);

  const blockedOnConsent = highRiskSelected.length > 0 && !highRiskConsent;

  const handlePlan = () => {
    planChanges.mutate(
      { data: { repo, goals: nextSteps, analysisId, itemRank } },
      {
        onSuccess: (data) => {
          setProposal(data);
          // Ordinary files start ticked; anything high-risk is opt-in.
          setApprovedPaths(new Set(data.plan.changes.filter((c) => c.risk !== "high").map((c) => c.path)));
          setHighRiskConsent(false);
          toast.success(`${data.plan.changes.length} change(s) proposed — nothing written yet`);
        },
        onError: (error) => toast.error(error.message.slice(0, 200)),
      },
    );
  };

  const togglePath = (path: string) => {
    setApprovedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleExecute = () => {
    if (!proposal) return;
    const paths = [...approvedPaths];
    if (paths.length === 0) {
      toast.error("Approve at least one file first");
      return;
    }

    const contents: Record<string, string> = {};
    for (const path of paths) {
      const content = proposal.proposedContents[path];
      if (content !== undefined) contents[path] = content;
    }

    executePlan.mutate(
      {
        data: {
          plan: proposal.plan,
          signature: proposal.signature,
          approval: { planId: proposal.plan.planId, approvedPaths: paths, highRiskConsent },
          contents,
        },
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setProposal(null);
          toast.success(`Draft PR #${data.pr_number} opened on ${repo}`);
        },
        onError: (error) => toast.error(error.message.slice(0, 300)),
      },
    );
  };

  return (
    <div className="space-y-3">
      {!proposal && !result && (
        <Button
          onClick={handlePlan}
          disabled={planChanges.isPending}
          className="gap-2"
          size="sm"
          data-testid={`button-plan-${repo}`}
        >
          {planChanges.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Planning {repo.split("/")[1]}...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Plan changes for {repo.split("/")[1]}
            </>
          )}
        </Button>
      )}

      {planChanges.isPending && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Reading the repository...</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pl-5">
            <p>• Fetching metadata and the file tree</p>
            <p>• Reading key source files</p>
            <p>• Proposing a reviewable change set</p>
            <p>• Nothing is written until you approve each file</p>
          </div>
        </Card>
      )}

      {proposal && (
        <Card className="p-4 space-y-4" data-testid="plan-review">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              <span className="font-semibold">Review proposed changes</span>
              <Badge variant="secondary" className="ml-auto">
                {approvedPaths.size} of {proposal.plan.changes.length} approved
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{proposal.plan.summary}</p>
            <p className="text-xs text-muted-foreground">
              Bound to <code className="text-xs">{proposal.plan.baseBranch}</code> at{" "}
              <code className="text-xs">{proposal.plan.baseCommitSha.slice(0, 7)}</code>. Expires{" "}
              {new Date(proposal.plan.expiresAt).toLocaleTimeString()}.
            </p>
          </div>

          <div className="space-y-2">
            {proposal.plan.changes.map((change) => (
              <div key={change.path} className="space-y-1 border-l-2 border-muted pl-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`approve-${change.path}`}
                    checked={approvedPaths.has(change.path)}
                    onCheckedChange={() => togglePath(change.path)}
                    data-testid={`checkbox-approve-${change.path}`}
                  />
                  <span className={STATUS_CLASS[change.status]}>{STATUS_GLYPH[change.status]}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`approve-${change.path}`} className="cursor-pointer">
                        <code className="text-xs">{change.path}</code>
                      </Label>
                      {change.risk === "high" && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <ShieldAlert className="h-3 w-3" />
                          high risk
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{change.description}</p>
                    {change.status !== "deleted" && (
                      <button
                        type="button"
                        onClick={() => setExpandedPath(expandedPath === change.path ? null : change.path)}
                        className="text-xs hover:underline"
                      >
                        {expandedPath === change.path ? "Hide" : "Show"} proposed content
                      </button>
                    )}
                    {expandedPath === change.path && (
                      <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                        {proposal.proposedContents[change.path] ?? "(no content returned)"}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {highRiskSelected.length > 0 && (
            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="high-risk-consent"
                    checked={highRiskConsent}
                    onCheckedChange={(checked) => setHighRiskConsent(checked === true)}
                    data-testid="checkbox-high-risk-consent"
                  />
                  <Label htmlFor="high-risk-consent" className="cursor-pointer text-sm font-medium">
                    I approve changes to {highRiskSelected.length} high-risk file
                    {highRiskSelected.length > 1 ? "s" : ""}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  CI workflows, containers, manifests, lockfiles, auth code and migrations can change what runs and
                  what gets deployed. {highRiskSelected.join(", ")}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleExecute}
              disabled={executePlan.isPending || approvedPaths.size === 0 || blockedOnConsent}
              size="sm"
              className="gap-2"
              data-testid="button-execute-plan"
            >
              {executePlan.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening draft PR...
                </>
              ) : (
                <>
                  <GitBranch className="h-4 w-4" />
                  Approve {approvedPaths.size} file{approvedPaths.size === 1 ? "" : "s"} and open a draft PR
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setProposal(null)} data-testid="button-discard-plan">
              Discard
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-4 space-y-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <span className="font-semibold">Draft PR #{result.pr_number} opened</span>
            <a
              href={result.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-sm text-blue-500 hover:underline flex items-center gap-1"
            >
              View PR <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <p className="text-sm text-muted-foreground">{result.summary}</p>

          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{result.branch}</code>
            <code className="text-xs text-muted-foreground">{result.commit_sha.slice(0, 7)}</code>
            <Badge variant="secondary" className="ml-auto">
              {result.files_changed} file{result.files_changed === 1 ? "" : "s"} changed
            </Badge>
          </div>

          <div className="space-y-1.5 pl-1">
            {result.changes.map((c) => (
              <div key={c.file} className="flex items-start gap-2 text-sm">
                <span className={STATUS_CLASS[c.status]}>{STATUS_GLYPH[c.status]}</span>
                <code className="text-xs">{c.file}</code>
                <span className="text-muted-foreground text-xs flex-1">{c.description}</span>
              </div>
            ))}
          </div>

          {result.skipped.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium">Proposed but not approved</p>
              {result.skipped.map((s) => (
                <p key={s.path}>
                  <code>{s.path}</code> — {s.reason}
                </p>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setResult(null)} className="gap-2">
            <Rocket className="h-3.5 w-3.5" />
            Plan another change set
          </Button>
        </Card>
      )}
    </div>
  );
}
