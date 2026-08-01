import { useState } from "react";
import { useFinishRepo, type FinishResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rocket, Loader2, GitBranch, ExternalLink, FileCode, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface FinishRepoActionProps {
  repo: string;
  nextSteps?: string[];
  analysisId?: string;
  itemRank?: number;
}

export function FinishRepoAction({ repo, nextSteps, analysisId, itemRank }: FinishRepoActionProps) {
  const [result, setResult] = useState<FinishResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const finishRepo = useFinishRepo();

  const handleFinish = () => {
    finishRepo.mutate(
      { data: { repo, nextSteps, analysisId, itemRank } },
      {
        onSuccess: (data) => {
          setResult(data);
          toast.success(`PR #${data.pr_number} opened on ${repo}`);
        },
        onError: (error) => {
          toast.error(error.message.slice(0, 200));
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {!result && (
        <Button onClick={handleFinish} disabled={finishRepo.isPending} className="gap-2" size="sm" data-testid={`button-finish-${repo}`}>
          {finishRepo.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finishing {repo.split("/")[1]}...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Auto-Finish {repo.split("/")[1]}
            </>
          )}
        </Button>
      )}

      {finishRepo.isPending && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Analyzing source files...</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pl-5">
            <p>• Fetching repo metadata and file tree</p>
            <p>• Reading key source files</p>
            <p>• AI generating improvements (README, CI, tests, bug fixes)</p>
            <p>• Creating branch and opening PR</p>
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-4 space-y-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <span className="font-semibold">PR #{result.pr_number} opened</span>
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
            <Badge variant="secondary" className="ml-auto">
              {result.files_changed} file{result.files_changed > 1 ? "s" : ""} changed
            </Badge>
          </div>

          <div className="space-y-1.5">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-sm font-medium flex items-center gap-1 hover:underline"
            >
              <FileCode className="h-3.5 w-3.5" />
              {showDetails ? "Hide" : "Show"} file changes
            </button>

            {showDetails && (
              <div className="space-y-1.5 pl-5 border-l-2 border-muted">
                {result.changes.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className={
                        c.status === "created"
                          ? "text-emerald-500 font-mono text-xs"
                          : c.status === "modified"
                            ? "text-yellow-500 font-mono text-xs"
                            : "text-red-500 font-mono text-xs"
                      }
                    >
                      {c.status === "created" ? "+" : c.status === "modified" ? "~" : "-"}
                    </span>
                    <code className="text-xs">{c.file}</code>
                    <span className="text-muted-foreground text-xs flex-1">{c.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => setResult(null)} className="gap-2">
            <Rocket className="h-3.5 w-3.5" />
            Run Again
          </Button>
        </Card>
      )}
    </div>
  );
}
