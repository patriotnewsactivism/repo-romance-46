import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Settings } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/auth");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-mono text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-primary glow-primary" />
            <span className="font-bold tracking-tight">repo_finisher</span>
          </Link>
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
                {email}
              </span>
            )}
            <Link
              href="/settings"
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
      {children}
    </div>
  );
}
