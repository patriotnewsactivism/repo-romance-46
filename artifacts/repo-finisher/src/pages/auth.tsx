import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithGitHub, getSession } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { SiGithub } from 'react-icons/si';
import { BRAND } from '@/lib/brand';

export default function Auth() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then(session => {
      if (session) {
        setLocation('/dashboard');
      }
    });
  }, [setLocation]);

  const handleSignIn = async () => {
    await signInWithGitHub();
  };

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setError(result.error.message);
      setBusy(false);
      return;
    }

    setLocation('/dashboard');
  };

  return (
    <div className="dark relative flex min-h-screen items-center justify-center bg-background p-4 font-mono text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(135deg, transparent 0 22px, rgba(155, 92, 255, 0.08) 22px 24px)',
        }}
      />

      <Card className="relative w-full max-w-md border-[#0A0A0A] bg-[#F5F1E8] text-[#0A0A0A] shadow-[10px_10px_0_#9B5CFF]">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <span
              aria-hidden
              className="block h-12 w-12 rotate-[-8deg] border-[3px] border-[#0A0A0A] bg-primary shadow-[4px_4px_0_#9B5CFF]"
            />
          </div>
          <CardTitle className="text-3xl">Welcome to {BRAND.name}</CardTitle>
          <CardDescription className="text-base text-[#0A0A0A]/70">
            Sign in to analyze your portfolio and discover product opportunities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleEmailAuth} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs uppercase tracking-widest">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="border-[3px] border-[#0A0A0A] bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs uppercase tracking-widest">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="border-[3px] border-[#0A0A0A] bg-white"
              />
            </div>

            {error && (
              <p role="alert" className="border-[3px] border-[#0A0A0A] bg-destructive/10 px-3 py-2 text-sm">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy} className="h-12 w-full text-base" size="lg">
              {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setError(null);
              }}
              className="w-full text-center text-xs uppercase tracking-widest underline decoration-2 underline-offset-4"
            >
              {mode === 'signup' ? 'I already have an account' : 'Create an account instead'}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-[#0A0A0A]/50">
            <span className="h-[3px] flex-1 bg-[#0A0A0A]/20" />
            or
            <span className="h-[3px] flex-1 bg-[#0A0A0A]/20" />
          </div>

          <div className="space-y-4">
            <Button
              onClick={handleSignIn}
              variant="outline"
              className="h-12 w-full text-base"
              size="lg"
              data-testid="button-github-signin"
            >
              <SiGithub className="mr-2 h-5 w-5" />
              Continue with GitHub
            </Button>
            <p className="text-center text-xs text-[#0A0A0A]/70">
              GitHub access includes private repositories and write permission so {BRAND.name} can open
              draft PRs. It never merges automatically.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
