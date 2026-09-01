import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DollarSign, ExternalLink, FileText, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Confidence = "low" | "medium" | "high";

type Source = { title: string; url: string; excerpt: string; score: number | null };
type Competitor = {
  name: string;
  url: string;
  pricing_summary: string;
  features: string[];
  positioning: string;
  evidence_urls: string[];
  confidence: Confidence;
};
type Suggestion = {
  title: string;
  why_it_matters: string;
  implementation_summary: string;
  desirability_score: number;
  confidence: Confidence;
  value_lift_usd: { low: number; high: number };
  monthly_revenue_scenario_usd: { low: number; base: number; high: number };
  assumptions: string[];
  competitor_gap: string;
  acceptance_checks: string[];
  risks: string[];
  evidence_urls: string[];
};
type GrowthResult = {
  research_status: "live" | "unavailable";
  research_provider: string | null;
  researched_at: string;
  market_category: string;
  market_summary: string;
  target_buyers: string[];
  competitors: Competitor[];
  feature_suggestions: Suggestion[];
  limitations: string[];
  sources: Source[];
};

type PreviewChange = { path: string; status: "created" | "modified" | "deleted"; content: string; description: string };
type Preview = {
  runId: string;
  repo: string;
  baseSha: string;
  planHash: string;
  summary: string;
  changes: PreviewChange[];
  objectiveKind: "feature" | "documentation";
  objectiveTitle: string;
  reviewRequired: true;
};
type RunDetail = {
  run: { id: string; status: string; prUrl: string | null; prNumber: number | null; error: string | null; ciStatus: string | null };
  verification: { state: string; message: string } | null;
};

const DOC_OPTIONS = ["README.md", "AGENTS.md", "PLAN.md", "ROADMAP.md", "docs"] as const;

function money(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

async function postJson<T>(path: string, body: unknown) {
  return customFetch<T>(path, { method: "POST", responseType: "json", body: JSON.stringify(body) });
}

export function RepositoryGrowthToolsPanel({ analysisId, itemRank, repo }: { analysisId: string; itemRank: number; repo: string }) {
  const [growth, setGrowth] = useState<GrowthResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<"research" | "plan" | "execute" | null>(null);
  const [docs, setDocs] = useState<string[]>(["README.md", "AGENTS.md", "PLAN.md", "docs"]);

  const loadRun = useCallback(async (runId: string) => {
    const result = await customFetch<RunDetail>(`/api/repo-finisher/runs/${runId}`, { responseType: "json" });
    setDetail(result);
    return result;
  }, []);

  useEffect(() => {
    const status = detail?.run.status;
    if (!preview?.runId || !status || !["executing", "verifying", "repairing"].includes(status)) return;
    const timer = window.setInterval(() => void loadRun(preview.runId).catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, [detail?.run.status, loadRun, preview?.runId]);

  const research = async () => {
    setBusy("research");
    try {
      const result = await postJson<GrowthResult>("/api/repo-growth-tools/research", { repo, analysisId, itemRank });
      setGrowth(result);
      toast.success(result.research_status === "live" ? "Live market research and growth analysis ready." : "Growth analysis ready; live market research is not configured.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : "Growth research failed.");
    } finally {
      setBusy(null);
    }
  };

  const plan = async (kind: "feature" | "documentation", title: string, goals: string[], documentationTargets?: string[]) => {
    setBusy("plan");
    setPreview(null);
    setDetail(null);
    try {
      const result = await postJson<Preview>("/api/repo-growth-tools/preview", {
        repo,
        analysisId,
        itemRank,
        kind,
        title,
        goals,
        documentationTargets,
      });
      setPreview(result);
      toast.success("Exact plan ready. Inspect the proposed files before approving execution.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 260) : "Unable to build a safe implementation plan.");
    } finally {
      setBusy(null);
    }
  };

  const approveAndExecute = async () => {
    if (!preview) return;
    setBusy("execute");
    try {
      await postJson(`/api/repo-finisher/runs/${preview.runId}/approve`, { planHash: preview.planHash });
      await postJson(`/api/repo-finisher/runs/${preview.runId}/execute`, {});
      const latest = await loadRun(preview.runId);
      toast.success(latest.run.status === "succeeded" ? "Implementation verified in a draft PR." : "Implementation started; verification remains enforced.");
    } catch (error) {
      await loadRun(preview.runId).catch(() => undefined);
      toast.error(error instanceof Error ? error.message.slice(0, 260) : "Implementation failed.");
    } finally {
      setBusy(null);
    }
  };

  const toggleDoc = (target: string) => setDocs((current) => current.includes(target) ? current.filter((value) => value !== target) : [...current, target]);

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Growth & diligence tools</div>
          <p className="text-xs text-muted-foreground">Source-backed market research, value/revenue scenarios, feature opportunities, and plan-first implementation.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-2 shrink-0" onClick={research} disabled={busy !== null}>
          {busy === "research" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {growth ? "Refresh market research" : "Research market & growth"}
        </Button>
      </div>

      <Card className="p-3 space-y-3 bg-muted/15">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4" /><span className="text-sm font-semibold">Documentation reconciliation</span></div>
        <p className="text-xs text-muted-foreground">Builds a documentation-only exact plan from implemented code. The server rejects the plan if it tries to change source, tests, workflows, migrations, lockfiles, runtime configuration, or delete files.</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {DOC_OPTIONS.map((target) => (
            <label key={target} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={docs.includes(target)} onChange={() => toggleDoc(target)} /> {target === "docs" ? "docs/*.md" : target}
            </label>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={busy !== null || docs.length === 0}
          onClick={() => plan("documentation", "Reconcile documentation with the implemented repository", [
            "Verify the actual architecture, user flows, scripts, environment variables, deployment targets, current limitations, and Definition of Done before documenting them.",
            "Update selected documentation so future humans and coding agents can rely on it as a current source of truth.",
            "Where a PLAN or ROADMAP is used, separate already-implemented work from evidence-backed remaining work and remove stale assumptions.",
          ], docs)}
        >
          {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Plan documentation update
        </Button>
      </Card>

      {growth && (
        <Card className="p-3 sm:p-4 space-y-4 bg-muted/15">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={growth.research_status === "live" ? "default" : "outline"}>{growth.research_status === "live" ? "Live web evidence" : "External research unavailable"}</Badge>
            <Badge variant="outline">{growth.market_category}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{growth.market_summary}</p>

          {growth.competitors.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-mono uppercase text-muted-foreground">Verified competitor snapshots</div>
              {growth.competitors.map((competitor) => (
                <div key={`${competitor.name}-${competitor.url}`} className="rounded border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={competitor.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-sm text-blue-500 hover:underline flex items-center gap-1">{competitor.name}<ExternalLink className="h-3 w-3" /></a>
                    <Badge variant="outline">{competitor.confidence} evidence</Badge>
                  </div>
                  <p className="text-xs"><span className="font-medium">Pricing:</span> {competitor.pricing_summary}</p>
                  <p className="text-xs text-muted-foreground">{competitor.positioning}</p>
                  {competitor.features.length > 0 && <div className="flex flex-wrap gap-1">{competitor.features.slice(0, 8).map((feature) => <Badge key={feature} variant="secondary" className="text-[10px]">{feature}</Badge>)}</div>}
                  <div className="flex flex-wrap gap-2 text-[10px]">{competitor.evidence_urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">source {index + 1}</a>)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-mono uppercase text-muted-foreground">Feature opportunities ranked for value unlock</div>
            {growth.feature_suggestions.map((suggestion) => {
              const monthly = suggestion.monthly_revenue_scenario_usd;
              return (
                <div key={suggestion.title} className="rounded border p-3 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm">{suggestion.title}</span><Badge variant="outline">desirability {suggestion.desirability_score}/100</Badge><Badge variant="outline">{suggestion.confidence}</Badge></div>
                      <p className="mt-1 text-xs text-muted-foreground">{suggestion.why_it_matters}</p>
                    </div>
                    <Button size="sm" className="gap-2 shrink-0" disabled={busy !== null} onClick={() => plan("feature", suggestion.title, [
                      suggestion.implementation_summary,
                      `Product rationale: ${suggestion.why_it_matters}`,
                      `Competitor/market gap to address: ${suggestion.competitor_gap}`,
                      ...suggestion.acceptance_checks.map((check) => `Acceptance check: ${check}`),
                      ...suggestion.risks.map((risk) => `Regression risk to explicitly guard against: ${risk}`),
                    ])}><Sparkles className="h-4 w-4" /> Plan implementation</Button>
                  </div>
                  <p className="text-xs">{suggestion.implementation_summary}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded bg-background/50 border p-2 text-xs"><div className="text-muted-foreground">Potential incremental IP/value lift</div><div className="font-semibold">{money(suggestion.value_lift_usd.low)} - {money(suggestion.value_lift_usd.high)}</div><div className="text-[10px] text-muted-foreground">Planning estimate, not appraisal</div></div>
                    <div className="rounded bg-background/50 border p-2 text-xs"><div className="text-muted-foreground">If marketed: monthly / annual scenario</div><div className="font-semibold">{money(monthly.low)} / {money(monthly.base)} / {money(monthly.high)} per month</div><div className="text-[10px] text-muted-foreground">Annual: {money(monthly.low * 12)} / {money(monthly.base * 12)} / {money(monthly.high * 12)}. Scenario only.</div></div>
                  </div>
                  <details className="text-xs"><summary className="cursor-pointer font-medium">Assumptions, evidence & risks</summary><div className="mt-2 space-y-2 text-muted-foreground"><p><span className="font-medium text-foreground">Assumptions:</span> {suggestion.assumptions.join("; ")}</p>{suggestion.evidence_urls.length > 0 && <p><span className="font-medium text-foreground">Evidence:</span> {suggestion.evidence_urls.map((url, index) => <span key={url}> <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">source {index + 1}</a></span>)}</p>}<p><span className="font-medium text-foreground">Risks:</span> {suggestion.risks.join("; ") || "No material risk supplied."}</p></div></details>
                </div>
              );
            })}
          </div>

          {growth.sources.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-medium">Research sources ({growth.sources.length})</summary><div className="mt-2 space-y-2">{growth.sources.map((source) => <div key={source.url} className="rounded border p-2"><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{source.title}</a><p className="mt-1 text-muted-foreground">{source.excerpt}</p></div>)}</div></details>}
          {growth.limitations.length > 0 && <p className="text-[10px] text-muted-foreground">Limitations: {growth.limitations.join(" ")}</p>}
        </Card>
      )}

      {preview && (
        <Card className="p-3 sm:p-4 space-y-3 border-violet-500/30">
          <div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-500" /><span className="font-semibold text-sm">Review exact {preview.objectiveKind} plan</span><Badge variant="outline">{preview.changes.length} files</Badge></div>
          <p className="text-xs text-muted-foreground">{preview.summary}</p>
          <div className="grid gap-2 text-xs sm:grid-cols-2"><div className="rounded border p-2"><span className="text-muted-foreground">Pinned base</span><div className="font-mono">{preview.baseSha.slice(0, 12)}</div></div><div className="rounded border p-2"><span className="text-muted-foreground">Plan hash</span><div className="font-mono">{preview.planHash.slice(0, 16)}...</div></div></div>
          <div className="space-y-2">{preview.changes.map((change) => <details key={change.path} className="rounded border p-2"><summary className="cursor-pointer text-xs font-mono break-all">{change.status === "created" ? "+" : change.status === "modified" ? "~" : "-"} {change.path} <span className="font-sans text-muted-foreground">- {change.description}</span></summary>{change.status !== "deleted" && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">{change.content}</pre>}</details>)}</div>
          {!detail && <Button size="sm" className="gap-2" onClick={approveAndExecute} disabled={busy !== null}>{busy === "execute" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve exact plan & execute</Button>}
          {detail && <div className="rounded border p-3 text-xs space-y-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Run status: {detail.run.status}</span>{detail.run.ciStatus && <Badge variant="outline">CI {detail.run.ciStatus}</Badge>}{detail.run.prUrl && <a href={detail.run.prUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-500 hover:underline flex items-center gap-1">Draft PR #{detail.run.prNumber}<ExternalLink className="h-3 w-3" /></a>}</div>{detail.verification && <p className="text-muted-foreground">Verification: {detail.verification.state} - {detail.verification.message}</p>}{detail.run.error && <p className="text-red-500">{detail.run.error}</p>}</div>}
        </Card>
      )}
    </div>
  );
}
