import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInWithGitHub, getSession } from '@/lib/auth';
import { SiGithub } from 'react-icons/si';
import { BRAND } from '@/lib/brand';

export default function Auth() {
  const [, setLocation] = useLocation();

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
            Connect your GitHub account to analyze your portfolio and discover product opportunities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleSignIn}
            className="h-12 w-full text-base"
            size="lg"
            data-testid="button-github-signin"
          >
            <SiGithub className="mr-2 h-5 w-5" />
            Continue with GitHub
          </Button>
          <p className="mt-4 text-center text-xs text-[#0A0A0A]/70">
            GitHub access includes private repositories and write permission so {BRAND.name} can open
            draft PRs. It never merges automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
