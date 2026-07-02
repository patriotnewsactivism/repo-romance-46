import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAnalysis } from "@/lib/analysis.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, GitMerge, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/analysis/$id")({
  component: AnalysisPage,
});

type Kind = "finish" | "combine" | "repurpose";

const KIND_META: Record<Kind, { label: string; icon: typeof Rocket; color: string }> = {
  finish: { label: "Finish", icon: Rocket, color: "text-ship border-ship/30 bg-ship/10" },
  combine: { label: "Combine", icon: GitMerge, color: "text-combine border-combine/30 bg-combine/10" },
  repurpose: { label: "Repurpose", icon: Sparkles, color: "text-repurpose border-repurpose/30 bg-repurpose/10" },
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getAnalysis);
  const q = useQuery({ queryKey: ["analysis", id], queryFn: () => fn({ data: { id } }) });
  const [filter, setFilter] = useState<Kind | "all">("all");

  if (q.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (q.isError) return <div className="p-10 text-sm text-destructive">{(q.error as Error).message}</div>;

  const { analysis, items } = q.data!;
  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);

  function downloadMd() {
    const lines: string[] = [];
    lines.push(`# RepoFinisher analysis — ${new Date(analysis.created_at).toLocaleString()}`);
    lines.push("");
    if (analysis.summary_md) {
      lines.push("## Summary");
      lines.push(analysis.summary_md);
      lines.push("");
    }
    for (const it of items) {
      lines.push(`## [${it.kind.toUpperCase()}] ${it.title}`);
      lines.push(`- **Repos:** ${(it.repos as string[]).map((r) => `\`${r}\``).join(", ")}`);
      lines.push(`- **Effort:** ${it.effort}/5 · **Market potential:** ${it.market_potential}/5`);
      lines.push("");
      lines.push(it.pitch);
      lines.push("");
      lines.push("**Next steps:**");
      for (const s of it.next_steps as string[]) lines.push(`- ${s}`);
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <Button onClick={downloadMd} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Download report
        </Button>
      </div>

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
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-mono ${meta.color}`}>
                  <Icon className="h-3 w-3" /> {meta.label}
                </div>
                <div className="text-right text-[10px] font-mono text-muted-foreground leading-tight">
                  <div>effort {it.effort}/5</div>
                  <div>market {it.market_potential}/5</div>
                </div>
              </div>
              <h3 className="font-semibold leading-tight">{it.title}</h3>
              <div className="flex flex-wrap gap-1">
                {(it.repos as string[]).map((r) => (
                  <Badge key={r} variant="secondary" className="font-mono text-[10px]">
                    {r}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{it.pitch}</p>
              {(it.next_steps as string[]).length > 0 && (
                <div>
                  <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">Next steps</div>
                  <ul className="space-y-1 text-sm">
                    {(it.next_steps as string[]).map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-primary">▸</span>
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
  );
}
