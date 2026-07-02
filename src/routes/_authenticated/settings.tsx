import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Github, Unplug, LogOut, User, Mail, Calendar, Shield } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getConnectionStatus, disconnectGithub } from "@/lib/github.functions";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const statusFn = useServerFn(getConnectionStatus);
  const disconnectFn = useServerFn(disconnectGithub);

  const status = useQuery({ queryKey: ["gh-status"], queryFn: () => statusFn() });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("GitHub disconnected");
      status.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  }

  const { user } = Route.useRouteContext();
  const connected = status.data?.connected;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <section>
        <h1 className="font-mono text-3xl font-bold tracking-tight">
          <span className="text-primary">$</span> settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and integrations.</p>
      </section>

      {/* Account section */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-mono font-semibold">Account</h2>
        </div>
        <div className="space-y-3">
          <Row icon={<Mail className="h-4 w-4" />} label="Email" value={user.email ?? "—"} />
          <Row
            icon={<Calendar className="h-4 w-4" />}
            label="Member since"
            value={
              user.created_at
                ? new Date(user.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "—"
            }
          />
          <Row
            icon={<Shield className="h-4 w-4" />}
            label="Auth provider"
            value={user.app_metadata?.provider ?? "email"}
          />
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </Card>

      {/* GitHub integration */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-mono font-semibold">GitHub Integration</h2>
        </div>
        {status.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking connection…</p>
        ) : connected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Github className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="font-mono text-sm font-medium">{status.data?.login}</div>
                  <div className="text-xs text-muted-foreground">
                    Connected{" "}
                    {status.data?.connected_at
                      ? formatDistanceToNow(new Date(status.data.connected_at), { addSuffix: true })
                      : "—"}
                  </div>
                </div>
              </div>
              <Badge variant="default" className="bg-primary/20 text-primary border-primary/30">
                Active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              RepoFinisher has read access to your public and private repositories. Disconnecting
              revokes access immediately.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMut.mutate()}
              disabled={disconnectMut.isPending}
            >
              <Unplug className="h-4 w-4 mr-2" />
              {disconnectMut.isPending ? "Disconnecting…" : "Disconnect GitHub"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Not connected. Visit the dashboard to connect your GitHub account.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.navigate({ to: "/dashboard" })}
            >
              Go to dashboard
            </Button>
          </div>
        )}
      </Card>

      {/* About */}
      <Card className="p-6 space-y-2">
        <h2 className="font-mono font-semibold">About RepoFinisher</h2>
        <p className="text-sm text-muted-foreground">
          RepoFinisher deep-samples your GitHub repos and uses AI to identify which are close to
          shippable, which can be combined into stronger products, and how to reposition existing
          code as marketable tools.
        </p>
        <p className="text-xs text-muted-foreground font-mono pt-2">
          Built with TanStack Start + Supabase + Lovable AI
        </p>
      </Card>
    </main>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground w-28 font-mono">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
