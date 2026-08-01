import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useConnectGithub } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';

export default function GithubCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  // Guards against a double-fire (React re-render/remount) trying to redeem
  // the same one-time-use GitHub authorization code twice.
  const attempted = useRef(false);
  const connectMut = useConnectGithub();

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const code = params.get('code');

    if (oauthError) {
      setError(
        oauthError === 'access_denied'
          ? 'GitHub authorization was cancelled.'
          : `GitHub returned an error: ${oauthError}`
      );
      return;
    }
    if (!code) {
      setError('No authorization code was returned by GitHub.');
      return;
    }

    connectMut.mutate(
      { data: { code } },
      {
        onSuccess: () => setLocation('/dashboard'),
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to connect GitHub.';
          setError(message);
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLocation]);

  if (error) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">GitHub Connection Failed</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <a href="/dashboard" className="text-primary hover:underline">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Connecting your GitHub account...</p>
      </div>
    </div>
  );
}
