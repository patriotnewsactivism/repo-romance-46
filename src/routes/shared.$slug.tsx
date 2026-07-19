import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPublicAnalysis } from "@/lib/analysis.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitMerge,
  Rocket,
  Sparkles,
  Github,
  ArrowRight,
  Package,
  Star,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/shared/$slug")({
  component: SharedAnalysisPage,
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

interface SharedItem {
  id: string;
  kind: string;
  title: string;
  repos: string[];
  pitch: string;
  effort: number;
  market_potential: number;
  next_steps: string[];
  tech_stack?: string[];
  estimated_hours?: number | null;
  rank: number;
}

function SharedAnalysisPage() {
  const { slug } = Route.useParams();
  const fn = useServerFn(getPublicAnalysis);
  const q = useQuery({
    queryKey: ["public-analysis", slug],
    queryFn: () => fn({ data: { slug } }),
  });
  const [filter, setFilter] = useState<Kind | "all">("all");

  if (q.isLoading)
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center text-sm text-muted-foreground">
        Loadingâ¦
      </div>
    );
  if (q.isError)
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">Analysis not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This share link may have been revoked.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            RepoFinisher <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>
    );

  const { analysis, items } = q.data! as unknown as {
    analysis: Record<string, unknown>;
    items: SharedItem[];
  };
  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const stats =
    (analysis.portfolio_stats as {
      languages?: { name: string; count: number; pct: number }[];
      total_repos?: number;
      total_stars?: number;
      most_active_repo?: string;
    }) || {};

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-mono text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-primary glow-primary" />
            <span className="font-bold tracking-tight">repo_finisher</span>
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Github className="h-4 w-4" /> Get your own audit
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <section>
          <div className="font-mono text-xs text-muted-foreground">
            shared analysis Â· {analysis.repo_count as number} repos
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Portfolio audit</h1>
          {!!analysis.summary_md && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
              {analysis.summary_md as string}
            </p>
          )}
        </section>

        {stats.languages?.length ? (
          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <Package className="h-4 w-4" /> Total repos
                </div>
                <div className="text-lg font-semibold">{stats.total_repos ?? "â"}</div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <Star className="h-4 w-4" /> Total stars
                </div>
                <div className="text-lg font-semibold">{stats.total_stars ?? "â"}</div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <TrendingUp className="h-4 w-4" /> Most active
                </div>
                <div className="text-lg font-semibold">
                  {stats.most_active_repo?.split("/").pop() ?? "â"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {stats.languages.map((lang) => (
                <Badge key={lang.name} variant="secondary" className="font-mono text-xs">
                  {lang.name} Â· {lang.pct}%
                </Badge>
              ))}
            </div>
          </Card>
        ) : null}

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
                  {items.filter((i) => i.kind === f).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((it) => {
            const meta = KIND_META[it.kind as Kind];
            const Icon = meta.icon;
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
                          <span className="text-primary">â¸</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No recommendations in this category.</p>
        )}
      </main>
    </div>
  );
}
