import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInWithGitHub, getSession } from '@/lib/auth';
import { SiGithub } from 'react-icons/si';
import { GitBranch } from 'lucide-react';

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
    <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-2/5 pointer-events-none" />
      
      <Card className="w-full max-w-md relative">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <GitBranch className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Welcome to RepoFinisher</CardTitle>
          <CardDescription className="text-base">
            Connect your GitHub account to analyze your portfolio and discover product opportunities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleSignIn} 
            className="w-full h-12 text-base" 
            size="lg"
            data-testid="button-github-signin"
          >
            <SiGithub className="w-5 h-5 mr-2" />
            Continue with GitHub
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-4">
            We'll request read access to your public repositories
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
