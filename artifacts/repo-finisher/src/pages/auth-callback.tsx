import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/integrations/supabase/client';
import { setAuthTokenGetter, useConnectGithub } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);
  const connectGithub = useConnectGithub();

  useEffect(() => {
    const persistGithubConnection = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      if (!session) {
        throw new Error('Supabase did not create a session after GitHub sign-in.');
      }

      // Make the just-issued bearer token available immediately, even if the
      // parent app has not yet completed any lifecycle effects.
      setAuthTokenGetter(async () => session.access_token);

      const providerToken = session.provider_token;
      if (!providerToken) {
        throw new Error(
          'GitHub sign-in succeeded, but Supabase did not return a GitHub provider token. Check the Supabase GitHub provider and OAuth redirect configuration, then reconnect.',
        );
      }

      await connectGithub.mutateAsync({ data: { providerToken } });
    };

    const handleCallback = async () => {
      if (attempted.current) return;
      attempted.current = true;

      try {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(window.location.href);

        if (exchangeError) {
          // React/dev remounts can race a one-time PKCE exchange. If a valid
          // session already exists, use it instead of treating the stale second
          // exchange as fatal.
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            throw exchangeError;
          }
          await persistGithubConnection(sessionData.session);
          setLocation('/dashboard');
          return;
        }

        await persistGithubConnection(data.session);
        setLocation('/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    };

    void handleCallback();
    // connectGithub is a mutation object whose identity is not useful here;
    // this callback must execute exactly once for the one-time OAuth code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLocation]);

  if (error) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <div className="text-center max-w-xl">
          <h1 className="text-2xl font-bold text-destructive mb-2">GitHub Connection Failed</h1>
          <p className="text-muted-foreground mb-4 break-words">{error}</p>
          <a href="/dashboard" className="text-primary hover:underline">
            Return to dashboard and reconnect GitHub
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Completing GitHub connection...</p>
      </div>
    </div>
  );
}
