import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Github, Loader2, PlayCircle, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
  getConnectionStatus,
  startGithubOAuth,
  disconnectGithub,
} from "@/lib/github.functions";
import { listAnalyses, runAnalysis } from "@/lib/analysis.functions";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const statusFn = useServerFn(getConnectionStatus);
  const startFn = useServerFn(startGithubOAuth);
  const disconnectFn = useServerFn(disconnectGithub);
  const listFn = useServerFn(listAnalyses);
  const runFn = useServerFn(runAnalysis);

  const status = useQuery({ queryKey: ["gh-status"], queryFn: () => statusFn() });
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: () => listFn() });

  const connectMut = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("GitHub disconnected");
      status.refetch();
    },
  });

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (res) => {
      toast.success("Analysis complete");
      analyses.refetch();
      router.navigate({ to: "/analysis/$id", params: { id: res.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connected = status.data?.connected;

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
                <Unplug className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending}
                className="glow-primary"
              >
                <Github className="h-4 w-4 mr-2" />
                {connectMut.isPending ? "…" : "Connect GitHub"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-medium">Run a new analysis</div>
            <div className="text-sm text-muted-foreground">
              Scans your most recently active repos and produces a ranked action report.
            </div>
          </div>
          <Button
            size="lg"
            disabled={!connected || runMut.isPending}
            onClick={() => runMut.mutate()}
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
        {runMut.isPending && (
          <p className="mt-3 text-xs text-muted-foreground font-mono">
            fetching repos → sampling code → asking the AI (this can take 30–90s)…
          </p>
        )}
      </Card>

      <section>
        <h2 className="font-mono text-sm text-muted-foreground mb-3">// past analyses</h2>
        {analyses.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !analyses.data?.length ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No analyses yet.
          </Card>
        ) : (
          <div className="space-y-2">
            {analyses.data.map((a) => (
              <Link
                key={a.id}
                to="/analysis/$id"
                params={{ id: a.id }}
                className="block"
              >
                <Card className="p-4 hover:border-primary/50 transition">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono text-sm">
                        analysis_{a.id.slice(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })} ·{" "}
                        {a.repo_count} repos
                      </div>
                    </div>
                    <Badge variant={a.status === "complete" ? "default" : "secondary"}>
                      {a.status}
                    </Badge>
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = Trash2;
