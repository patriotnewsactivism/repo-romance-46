import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Github,
  Loader2,
  PlayCircle,
  Unplug,
  Package,
  Star,
  Clock,
  TrendingUp,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getConnectionStatus,
  startGithubOAuth,
  disconnectGithub,
  getPortfolioSummary,
} from "@/lib/api-client";
import { listAnalyses, runAnalysis, deleteAnalysis } from "@/lib/api-client";
import { getPreferences } from "@/lib/api-client";
import { formatDistanceToNow } from "date-fns";

interface PortfolioSummary {
  login: string;
  totalRepos: number;
  totalStars: number;
  dormantCount: number;
  avgSizeKb: number;
  topLanguages: { name: string; count: number; pct: number }[];
  mostRecentPush: string;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const status = useQuery({ queryKey: ["gh-status"], queryFn: () => getConnectionStatus() });
  const portfolio = useQuery({
    queryKey: ["gh-portfolio"],
    queryFn: () => getPortfolioSummary(),
    enabled: !!status.data?.connected,
  });
  const analysesQuery = useQuery({ queryKey: ["analyses"], queryFn: () => listAnalyses() });
  const analysesList = (analysesQuery.data?.analyses ?? []) as Record<string, unknown>[];
  useQuery({
    queryKey: ["prefs"],
    queryFn: () => getPreferences(),
    enabled: !!status.data?.connected,
  });

  const connectMut = useMutation({
    mutationFn: () => startGithubOAuth(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGithub(),
    onSuccess: () => {
      toast.success("GitHub disconnected");
      status.refetch();
      portfolio.refetch();
    },
  });

  const runMut = useMutation({
    mutationFn: () => runAnalysis(),
    onSuccess: (res) => {
      toast.success("Analysis complete");
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      navigate(`/analysis/${res.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnalysis(id),
    onSuccess: () => {
      toast.success("Analysis deleted");
      analysesQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connected = status.data?.connected;
  const summary = (portfolio.data as { connected: boolean; summary: PortfolioSummary | null } | undefined)
    ?.summary;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <section>
        <h1 className="font-mono text-3xl font-bold tracking-tight">
          <span className="text-primary">$</span> dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect GitHub, then run an analysis. We'll rank what to finish, combine, or repurpose.
        </p>
      </section>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Github className="h-8 w-8" />
            <div>
              <div className="font-medium">GitHub connection</div>
              <div className="text-sm text-muted-foreground font-mono">
                {status.isLoading
                  ? "checking…"
                  : connected
                    ? `connected as ${status.data?.login}`
                    : "not connected"}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {connected ? (
              <Button
                variant="outline"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-4 w-4 mr-2" /> Disconnect
              </Button>
            ) : (
              <Button
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending}
                className="glow-primary"
              >
                <Github className="h-4 w-4 mr-2" /> {connectMut.isPending ? "…" : "Connect GitHub"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {connected && summary && (
        <Card className="p-6">
          <h2 className="font-mono text-sm text-muted-foreground mb-4">// portfolio preview</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <StatTile
              icon={<Package className="h-4 w-4" />}
              label="Active repos"
              value={summary.totalRepos}
            />
            <StatTile
              icon={<Star className="h-4 w-4" />}
              label="Total stars"
              value={summary.totalStars}
            />
            <StatTile
              icon={<Clock className="h-4 w-4" />}
              label="Dormant (6mo+)"
              value={summary.dormantCount}
            />
            <StatTile
              icon={<TrendingUp className="h-4 w-4" />}
              label="Avg size"
              value={`${summary.avgSizeKb}KB`}
            />
          </div>
          {summary.topLanguages.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-mono text-muted-foreground mb-2">Top languages</div>
              <div className="flex flex-wrap gap-2">
                {summary.topLanguages.map((lang) => (
                  <Badge key={lang.name} variant="secondary" className="font-mono text-xs">
                    {lang.name} · {lang.pct}%
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {summary.dormantCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-500/80">
              <AlertTriangle className="h-3.5 w-3.5" />
              {summary.dormantCount} repos haven't been pushed in 6+ months — prime candidates for
              finishing or archiving.
            </div>
          )}
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-medium">Run new analysis</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {connected
                ? "Deep-sample up to 25 repos and get AI recommendations"
                : "Connect GitHub first"}
            </div>
          </div>
          <Button
            onClick={() => runMut.mutate()}
            disabled={!connected || runMut.isPending}
            className="glow-primary"
          >
            {runMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing…
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" /> Run analysis
              </>
            )}
          </Button>
        </div>
        {connected && (
          <Link
            href="/settings"
            className="text-xs font-mono text-muted-foreground hover:text-foreground mt-2 inline-block"
          >
            Configure filters & schedule →
          </Link>
        )}
        {runMut.isPending && (
          <p className="mt-3 text-xs text-muted-foreground font-mono">
            fetching repos → sampling code → asking the AI (this can take 30–90s)…
          </p>
        )}
      </Card>

      <section>
        <h2 className="font-mono text-sm text-muted-foreground mb-3">// past analyses</h2>
        {analysesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !analysesList.length ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No analyses yet. Run your first analysis above.
          </Card>
        ) : (
          <div className="space-y-2">
            {analysesList.map((a) => (
              <Link key={a.id as string} href={`/analysis/${a.id}`} className="block">
                <Card className="p-4 hover:border-primary/50 transition">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono text-sm">
                        analysis_{(a.id as string).slice(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(a.created_at as string), {
                          addSuffix: true,
                        })}{" "}
                        · {a.repo_count as number} repos
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.status === "complete" ? "default" : "secondary"}>
                        {a.status as string}
                      </Badge>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (confirm("Delete this analysis?")) deleteMut.mutate(a.id as string);
                        }}
                        className="text-muted-foreground hover:text-destructive transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
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
