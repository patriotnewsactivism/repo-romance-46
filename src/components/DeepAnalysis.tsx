import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { deepAnalyzeRepo } from "@/lib/deep-analysis.functions";
import { getRepoLearnings } from "@/lib/learning-log.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileCode,
  Package,
  Shield,
  Rocket,
  Brain,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface DeepAnalysisProps {
  repo: string;
}

export function DeepAnalysis({ repo }: DeepAnalysisProps) {
  const analyzeFn = useServerFn(deepAnalyzeRepo);
  const learningsFn = useServerFn(getRepoLearnings);
  const [expanded, setExpanded] = useState(false);
  const [showStubs, setShowStubs] = useState(false);
  const [showDeps, setShowDeps] = useState(false);
  const [showLearnings, setShowLearnings] = useState(false);

  const analyzeMut = useMutation({
    mutationFn: () => analyzeFn({ data: { repo } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const learningsQ = useQuery({
    queryKey: ["learnings", repo],
    queryFn: () => learningsFn({ data: { repo } }),
    enabled: expanded,
  });

  const result = analyzeMut.data;

  if (!expanded && !result) {
    return (
      <button
        onClick={() => {
          setExpanded(true);
          analyzeMut.mutate();
        }}
        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition"
      >
        <Search className="h-3 w-3" />
        Deep structural analysis
      </button>
    );
  }

  if (analyzeMut.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="font-mono">
          Analyzing code structure, dependencies, tests, deploy readiness…
        </span>
      </div>
    );
  }

  if (analyzeMut.isError) {
    return (
      <div className="text-xs text-destructive">
        Analysis failed: {analyzeMut.error.message}
        <Button
          variant="ghost"
          size="sm"
          className="ml-2 h-5 px-1.5 text-xs"
          onClick={() => analyzeMut.mutate()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const verdictColors: Record<string, string> = {
    "abandoned-scaffolding": "text-red-500 bg-red-500/10 border-red-500/30",
    "early-stage": "text-orange-500 bg-orange-500/10 border-orange-500/30",
    "half-built": "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
    "mostly-done": "text-blue-500 bg-blue-500/10 border-blue-500/30",
    shippable: "text-green-500 bg-green-500/10 border-green-500/30",
  };

  const outdatedDeps = result.dependencyHealth.filter((d) => d.status === "major-behind");
  const minorDeps = result.dependencyHealth.filter((d) => d.status === "minor-behind");

  return (
    <div className="space-y-3">
      {/* Completion Score */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{result.completion.percentage}%</span>
            <Badge
              variant="outline"
              className={`text-[10px] font-mono ${verdictColors[result.completion.verdict] || ""}`}
            >
              {result.completion.verdict.replace(/-/g, " ")}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => analyzeMut.mutate()}
          >
            Re-scan
          </Button>
        </div>
        <Progress value={result.completion.percentage} className="h-2" />
        <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
          {result.completion.evidence.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat
          icon={<FileCode className="h-3 w-3" />}
          label="Source"
          value={result.fileBreakdown.source}
        />
        <MiniStat
          icon={<Shield className="h-3 w-3" />}
          label="Tests"
          value={result.testCoverage.testFileCount}
          alert={result.testCoverage.testFileCount === 0}
        />
        <MiniStat
          icon={<Package className="h-3 w-3" />}
          label="Outdated"
          value={outdatedDeps.length}
          alert={outdatedDeps.length > 0}
        />
        <MiniStat
          icon={<Rocket className="h-3 w-3" />}
          label="Deploy"
          value={result.deployReadiness.deployTarget || "None"}
          alert={!result.deployReadiness.hasDeployConfig}
        />
      </div>

      {/* Test Coverage */}
      {result.testCoverage.testFileCount === 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>
            No tests — can&apos;t verify anything works.{" "}
            {result.testCoverage.hasTestFramework
              ? `${result.testCoverage.framework} is configured but no test files exist.`
              : "No test framework detected."}
          </span>
        </div>
      ) : (
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            <span>
              {result.testCoverage.testFileCount} test files ({result.testCoverage.framework})
              · {Math.round(result.testCoverage.testToSourceRatio * 100)}% test ratio
            </span>
          </div>
          {result.testCoverage.uncoveredPaths.length > 0 && (
            <div className="text-[10px] text-muted-foreground font-mono">
              Untested dirs: {result.testCoverage.uncoveredPaths.slice(0, 5).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Deploy Readiness */}
      {result.deployReadiness.issues.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground uppercase">Deploy Issues</div>
          {result.deployReadiness.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <XCircle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stubs / TODOs */}
      {result.stubs.length > 0 && (
        <div>
          <button
            onClick={() => setShowStubs(!showStubs)}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            {showStubs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {result.stubs.length} TODOs / stubs / FIXMEs
          </button>
          {showStubs && (
            <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto">
              {result.stubs.slice(0, 25).map((stub, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[10px] font-mono text-muted-foreground"
                >
                  <Badge
                    variant="outline"
                    className={`text-[8px] shrink-0 ${
                      stub.kind === "fixme" || stub.kind === "hack"
                        ? "text-red-400 border-red-400/30"
                        : stub.kind === "todo"
                          ? "text-amber-400 border-amber-400/30"
                          : "text-blue-400 border-blue-400/30"
                    }`}
                  >
                    {stub.kind}
                  </Badge>
                  <span className="truncate">
                    {stub.file}:{stub.line} — {stub.snippet}
                  </span>
                </div>
              ))}
              {result.stubs.length > 25 && (
                <div className="text-[10px] text-muted-foreground">
                  …and {result.stubs.length - 25} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dependency Health */}
      {result.dependencyHealth.length > 0 && (
        <div>
          <button
            onClick={() => setShowDeps(!showDeps)}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            {showDeps ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Dependencies: {outdatedDeps.length} major behind, {minorDeps.length} minor behind
          </button>
          {showDeps && (
            <div className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
              {result.dependencyHealth
                .filter((d) => d.status !== "up-to-date" && d.status !== "unknown")
                .map((dep, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground"
                  >
                    <span
                      className={
                        dep.status === "major-behind" ? "text-red-400" : "text-yellow-400"
                      }
                    >
                      {dep.status === "major-behind" ? "▲" : "△"}
                    </span>
                    <span>{dep.name}</span>
                    <span className="text-muted-foreground/60">
                      {dep.current} → {dep.latest || "?"}
                    </span>
                    {dep.isDevDep && <Badge variant="outline" className="text-[8px]">dev</Badge>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Learning History */}
      {learningsQ.data?.has_history && (
        <div>
          <button
            onClick={() => setShowLearnings(!showLearnings)}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            {showLearnings ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Brain className="h-3 w-3" />
            {learningsQ.data.history.length} past operations logged
          </button>
          {showLearnings && (
            <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto">
              {learningsQ.data.patterns_detected.length > 0 && (
                <Card className="p-2 border-amber-500/20 bg-amber-500/5">
                  <div className="text-[10px] font-mono text-amber-500 mb-1">Detected Patterns</div>
                  {learningsQ.data.patterns_detected.map((p, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground">
                      • {p}
                    </div>
                  ))}
                </Card>
              )}
              {learningsQ.data.history
                .slice(-10)
                .reverse()
                .map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-[10px] font-mono text-muted-foreground"
                  >
                    <span
                      className={
                        entry.outcome === "success"
                          ? "text-green-400"
                          : entry.outcome === "failure"
                            ? "text-red-400"
                            : "text-yellow-400"
                      }
                    >
                      {entry.outcome === "success"
                        ? "✓"
                        : entry.outcome === "failure"
                          ? "✗"
                          : "~"}
                    </span>
                    <span className="truncate">
                      {entry.action}: {entry.details.slice(0, 80)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div className={`text-center space-y-0.5 ${alert ? "text-amber-500" : ""}`}>
      <div className="flex justify-center">{icon}</div>
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[9px] font-mono text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
