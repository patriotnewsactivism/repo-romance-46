import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/integrations/supabase/client';
import { useConnectGithub } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  // Guards against a double-fire of this effect (React re-render / remount)
  // trying to exchange the same one-time-use auth code twice. The first
  // call succeeds and creates the session; a second call then fails with
  // "auth code and code verifier should be non-empty" even though sign-in
  // already worked — which used to show the user a scary error page while
  // actually being signed in.
  const attempted = useRef(false);
  const connectGithub = useConnectGithub();

  useEffect(() => {
    const handleCallback = async () => {
      if (attempted.current) return;
      attempted.current = true;

      try {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          window.location.href
        );

        if (exchangeError) {
          // Before showing an error, double-check whether a session already
          // exists (e.g. an earlier/parallel exchange for this same code
          // already succeeded). If so, this "error" is stale — proceed.
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session) {
            setLocation('/dashboard');
            return;
          }
          setError(exchangeError.message);
          return;
        }

        // Supabase's GitHub OAuth (scope: 'repo') hands back a GitHub access
        // token on the session — only available right after this exchange.
        // Persist it server-side so GitHub-dependent routes can use it.
        const providerToken = data.session?.provider_token;
        if (providerToken) {
          try {
            await connectGithub.mutateAsync({ data: { providerToken } });
          } catch {
            // Non-fatal — dashboard falls back to a "Connect GitHub" prompt.
          }
        }

        setLocation('/dashboard');
      } catch (err) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          setLocation('/dashboard');
          return;
        }
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    };

    handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLocation]);

  if (error) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">Authentication Error</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <a href="/auth" className="text-primary hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Completing sign-in...</p>
      </div>
    </div>
  );
}
