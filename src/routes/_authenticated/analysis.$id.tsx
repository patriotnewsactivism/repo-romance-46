import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAnalysis, toggleShare, rerunAnalysis, deleteAnalysis } from "@/lib/analysis.functions";
import { toggleStar } from "@/lib/preferences.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Download,
  GitMerge,
  Rocket,
  Sparkles,
  Share2,
  Copy,
  Code2,
  Twitter,
  Linkedin,
  Clock,
  Star,
  TrendingUp,
  Package,
  Loader2,
  RefreshCw,
  Trash2,
  DollarSign,
} from "lucide-react";
import { useState } from "react";
import { ActionPlan } from "@/components/ActionPlan";
import { RepoHealthCheck } from "@/components/RepoHealth";
import { MergeInstructions } from "@/components/MergeInstructions";
import { RepoFinisher } from "@/components/RepoFinisher";
import { PortfolioValuation } from "@/components/PortfolioValuation";
import { VibeTools } from "@/components/VibeTools";

import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/analysis/$id")({
  component: AnalysisPage,
});

type Kind = "finish" | "combine" | "repurpose";

const KIND_META: Record<Kind, { label: string; icon: typeof Rocket; color: string }> = {
  finish: { label: "Finish", icon: Rocket, color: "text-ship border-ship/30 bg-ship/10" },
  combine: {
    label: "Combine",
    icon: GitMerge,
    color: "text-combine border-combine/30 bg-combine/10",
  },
  repurpose: {
    label: "Repurpose",
    icon: Sparkles,
    color: "text-repurpose border-repurpose/30 bg-repurpose/10",
  },
};

interface AnalysisItem {
  id: string;
  kind: string;
  title: string;
  repos: string[];
  pitch: string;
  effort: number;
  market_potential: number;
  next_steps: string[];
  tech_stack?: string[];
  marketing_tweet?: string | null;
  marketing_linkedin?: string | null;
  estimated_hours?: number | null;
  is_starred?: boolean;
  rank: number;
}

interface PortfolioStats {
  total_repos?: number;
  total_stars?: number;
  most_active_repo?: string;
  dormant_repos?: string[];
  average_repo_size_kb?: number;
  languages?: { name: string; count: number; pct: number }[];
}

function AnalysisPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const fn = useServerFn(getAnalysis);
  const shareFn = useServerFn(toggleShare);
  const rerunFn = useServerFn(rerunAnalysis);
  const deleteFn = useServerFn(deleteAnalysis);
  const starFn = useServerFn(toggleStar);
  const q = useQuery({ queryKey: ["analysis", id], queryFn: () => fn({ data: { id } }) });
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [tab, setTab] = useState<"recommendations" | "actionPlan" | "valuation">("recommendations");
  const [expandedMarketing, setExpandedMarketing] = useState<string | null>(null);

  const shareMut = useMutation({
    mutationFn: (isPublic: boolean) => shareFn({ data: { id, isPublic } }),
    onSuccess: (res) => {
      if (res.isPublic && res.slug) {
        const url = `${window.location.origin}/shared/${res.slug}`;
        navigator.clipboard.writeText(url);
        toast.success("Share link copied to clipboard!");
      } else {
        toast.success("Analysis is now private");
      }
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rerunMut = useMutation({
    mutationFn: () => rerunFn({ data: { analysisId: id } }),
    onSuccess: (res) => {
      toast.success("Re-analysis complete — new results ready");
      router.navigate({ to: "/analysis/$id", params: { id: res.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Analysis deleted");
      router.navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const starMut = useMutation({
    mutationFn: ({ itemId, starred }: { itemId: string; starred: boolean }) =>
      starFn({ data: { itemId, starred } }),
    onSuccess: () => q.refetch(),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (q.isError)
    return <div className="p-10 text-sm text-destructive">{(q.error as Error).message}</div>;

  const { analysis, items } = q.data!;
  const typedItems = items as unknown as AnalysisItem[];
  const filtered = filter === "all" ? typedItems : typedItems.filter((i) => i.kind === filter);
  const stats = (analysis.portfolio_stats as unknown as PortfolioStats) || {};
  const isPublic = (analysis as Record<string, unknown>).is_public as boolean;
  const shareSlug = (analysis as Record<string, unknown>).share_slug as string | null;

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  }

  function downloadMd() {
    const lines: string[] = [];
    lines.push(`# RepoFinisher analysis — ${new Date(analysis.created_at).toLocaleString()}`);
    lines.push("");
    if (analysis.summary_md) {
      lines.push("## Summary");
      lines.push(analysis.summary_md);
      lines.push("");
    }
    if (stats.languages?.length) {
      lines.push("## Portfolio Stats");
      lines.push(`- Total repos: ${stats.total_repos ?? "—"}`);
      lines.push(`- Total stars: ${stats.total_stars ?? "—"}`);
      lines.push(`- Most active: ${stats.most_active_repo ?? "—"}`);
      if (stats.dormant_repos?.length) lines.push(`- Dormant: ${stats.dormant_repos.join(", ")}`);
      lines.push("");
    }
    for (const it of typedItems) {
      lines.push(`## [${it.kind.toUpperCase()}] ${it.title}`);
      lines.push(`- **Repos:** ${it.repos.map((r) => `\`${r}\``).join(", ")}`);
      lines.push(`- **Effort:** ${it.effort}/5 · **Market potential:** ${it.market_potential}/5`);
      if (it.estimated_hours) lines.push(`- **Estimated time:** ${it.estimated_hours}h`);
      if (it.tech_stack?.length) lines.push(`- **Tech stack:** ${it.tech_stack.join(", ")}`);
      lines.push("");
      lines.push(it.pitch);
      lines.push("");
      lines.push("**Next steps:**");
      for (const s of it.next_steps) lines.push(`- ${s}`);
      if (it.marketing_tweet) {
        lines.push("");
        lines.push("**Tweet:**");
        lines.push(`> ${it.marketing_tweet}`);
      }
      if (it.marketing_linkedin) {
        lines.push("");
        lines.push("**LinkedIn:**");
        lines.push(`> ${it.marketing_linkedin}`);
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `repo-finisher-${id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    const data = {
      analysis: {
        id: analysis.id,
        created_at: analysis.created_at,
        repo_count: analysis.repo_count,
        summary_md: analysis.summary_md,
        portfolio_stats: stats,
      },
      recommendations: typedItems.map((it) => ({
        kind: it.kind,
        title: it.title,
        repos: it.repos,
        pitch: it.pitch,
        effort: it.effort,
        market_potential: it.market_potential,
        next_steps: it.next_steps,
        tech_stack: it.tech_stack,
        marketing_tweet: it.marketing_tweet,
        marketing_linkedin: it.marketing_linkedin,
        estimated_hours: it.estimated_hours,
        rank: it.rank,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `repo-finisher-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <div className="flex gap-2">
          <Button
            onClick={() => shareMut.mutate(!isPublic)}
            variant="outline"
            size="sm"
            disabled={shareMut.isPending}
          >
            <Share2 className="h-4 w-4 mr-2" />
            {isPublic ? "Unshare" : "Share"}
          </Button>
          <Button onClick={downloadJson} variant="outline" size="sm">
            <Code2 className="h-4 w-4 mr-2" /> JSON
          </Button>
          <Button
            onClick={() => rerunMut.mutate()}
            variant="outline"
            size="sm"
            disabled={rerunMut.isPending}
          >
            {rerunMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Re-run
          </Button>
          <Button onClick={downloadMd} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" /> Markdown
          </Button>
          <Button
            onClick={() => {
              if (confirm("Delete this analysis? This cannot be undone.")) deleteMut.mutate();
            }}
            variant="ghost"
            size="sm"
            disabled={deleteMut.isPending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isPublic && shareSlug && (
        <Card className="p-3 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 text-sm">
            <Share2 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Public link:</span>
            <code className="font-mono text-xs">
              {window.location.origin}/shared/{shareSlug}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() =>
                copyToClipboard(`${window.location.origin}/shared/${shareSlug}`, "Link")
              }
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </Card>
      )}

      <section>
        <div className="font-mono text-xs text-muted-foreground">
          analysis_{id.slice(0, 8)} · {analysis.repo_count} repos
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Portfolio audit</h1>
        {analysis.summary_md && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
            {analysis.summary_md}
          </p>
        )}
      </section>

      {/* Portfolio Stats */}
      {stats.languages?.length ? (
        <Card className="p-5">
          <h2 className="font-mono text-sm text-muted-foreground mb-4">// portfolio stats</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <StatTile
              icon={<Package className="h-4 w-4" />}
              label="Total repos"
              value={stats.total_repos ?? "—"}
            />
            <StatTile
              icon={<Star className="h-4 w-4" />}
              label="Total stars"
              value={stats.total_stars ?? "—"}
            />
            <StatTile
              icon={<TrendingUp className="h-4 w-4" />}
              label="Most active"
              value={stats.most_active_repo?.split("/").pop() ?? "—"}
            />
            <StatTile
              icon={<Clock className="h-4 w-4" />}
              label="Avg size"
              value={
                stats.average_repo_size_kb ? `${Math.round(stats.average_repo_size_kb)}KB` : "—"
              }
            />
          </div>
          {stats.languages.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-mono text-muted-foreground mb-2">Languages</div>
              <div className="flex flex-wrap gap-2">
                {stats.languages.map((lang) => (
                  <Badge key={lang.name} variant="secondary" className="font-mono text-xs">
                    {lang.name} · {lang.pct}%
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {stats.dormant_repos && stats.dormant_repos.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-mono text-muted-foreground mb-2">
                Dormant (6+ months)
              </div>
              <div className="flex flex-wrap gap-1">
                {stats.dormant_repos.map((r) => (
                  <Badge
                    key={r}
                    variant="outline"
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("recommendations")}
          className={`px-4 py-2 text-sm font-mono border-b-2 transition ${
            tab === "recommendations"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Recommendations
        </button>
        <button
          onClick={() => setTab("actionPlan")}
          className={`px-4 py-2 text-sm font-mono border-b-2 transition ${
            tab === "actionPlan"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Action Plan
        </button>
        <button
          onClick={() => setTab("valuation")}
          className={`px-4 py-2 text-sm font-mono border-b-2 transition ${
            tab === "valuation"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Valuation
        </button>
      </div>

      {tab === "recommendations" && (
        <>
          <div className="flex flex-wrap gap-2">
            {(["all", "finish", "combine", "repurpose"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-mono border transition ${
                  filter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                {f}
                {f !== "all" && (
                  <span className="ml-1.5 opacity-60">
                    {typedItems.filter((i) => i.kind === f).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((it) => {
              const meta = KIND_META[it.kind as Kind];
              const Icon = meta.icon;
              const marketingOpen = expandedMarketing === it.id;
              return (
                <Card key={it.id} className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-mono ${meta.color}`}
                    >
                      <Icon className="h-3 w-3" /> {meta.label}
                    </div>
                    <div className="text-right text-[10px] font-mono text-muted-foreground leading-tight">
                      <div>effort {it.effort}/5</div>
                      <div>market {it.market_potential}/5</div>
                      {it.estimated_hours ? (
                        <div className="text-primary mt-0.5">~{it.estimated_hours}h</div>
                      ) : null}
                    </div>
                  </div>
                  <h3 className="font-semibold leading-tight">{it.title}</h3>
                  <div className="flex flex-wrap gap-1">
                    {it.repos.map((r) => (
                      <Badge key={r} variant="secondary" className="font-mono text-[10px]">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  {it.tech_stack && it.tech_stack.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {it.tech_stack.map((tech) => (
                        <Badge key={tech} variant="outline" className="text-[10px] font-mono">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">{it.pitch}</p>
                  {it.next_steps.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">
                        Next steps
                      </div>
                      <ul className="space-y-1 text-sm">
                        {it.next_steps.map((s, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-primary">▸</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Health check for each repo */}
                  {it.repos.length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <RepoHealthCheck repo={it.repos[0]} />
                    </div>
                  )}

                  {/* Auto-finish button for finish recommendations */}
                  {it.kind === "finish" && it.repos.length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <RepoFinisher
                        repo={it.repos[0]}
                        nextSteps={it.next_steps}
                        analysisId={id}
                        itemRank={it.rank}
                        kind={it.kind}
                      />
                    </div>
                  )}

                  {/* Merge instructions for combine recommendations */}
                  {it.kind === "combine" && (
                    <MergeInstructions analysisId={id} itemRank={it.rank} />
                  )}

                  {/* Marketing copy */}
                  {(it.marketing_tweet || it.marketing_linkedin) && (
                    <div className="pt-2 border-t border-border">
                      <button
                        onClick={() => setExpandedMarketing(marketingOpen ? null : it.id)}
                        className="text-xs font-mono text-muted-foreground hover:text-foreground"
                      >
                        {marketingOpen ? "▾ hide marketing copy" : "▸ show marketing copy"}
                      </button>
                      {marketingOpen && (
                        <div className="mt-3 space-y-3">
                          {it.marketing_tweet && (
                            <div className="rounded-md border border-border bg-muted/30 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                                  <Twitter className="h-3 w-3" /> Tweet
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => copyToClipboard(it.marketing_tweet!, "Tweet")}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <p className="text-sm">{it.marketing_tweet}</p>
                            </div>
                          )}
                          {it.marketing_linkedin && (
                            <div className="rounded-md border border-border bg-muted/30 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                                  <Linkedin className="h-3 w-3" /> LinkedIn
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() =>
                                    copyToClipboard(it.marketing_linkedin!, "LinkedIn post")
                                  }
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{it.marketing_linkedin}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">No recommendations in this category.</p>
          )}
        </>
      )}

      {tab === "actionPlan" && <ActionPlan analysisId={id} />}
    </main>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        {icon} {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
