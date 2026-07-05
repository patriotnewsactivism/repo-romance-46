// Supabase auth pattern.
import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

function AuthedShell() {
  const { user } = Route.useRouteContext();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-mono text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-primary glow-primary" />
            <span className="font-bold tracking-tight">repo_finisher</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
              {user.email}
            </span>
            <Link
              to="/team"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-accent h-9 px-3"
            >
              <Users className="h-4 w-4" />
            </Link>
            <Link
              to="/settings"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-accent h-9 px-3"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
