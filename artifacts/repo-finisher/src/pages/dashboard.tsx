import { useEffect, type MouseEvent } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useGetGithubStatus,
  useGetPortfolioSummary,
  useListAnalyses,
  useRunAnalysis,
  useDeleteAnalysis,
  getListAnalysesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signInWithGitHub } from '@/lib/auth';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus, Code, AlertCircle, CheckCircle, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: githubStatus, isLoading: githubLoading } = useGetGithubStatus();
  const { data: portfolio, isLoading: portfolioLoading } = useGetPortfolioSummary();
  const { data: analyses, isLoading: analysesLoading } = useListAnalyses();
  const runAnalysis = useRunAnalysis();
  const deleteAnalysis = useDeleteAnalysis();

  const handleDelete = (e: MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this analysis? This cannot be undone.')) return;

    deleteAnalysis.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success('Analysis deleted');
          queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey() });
        },
        onError: (error) => {
          toast.error('Failed to delete analysis', { description: error.message });
        },
      },
    );
  };

  useEffect(() => {
    getSession().then(session => {
      if (!session) setLocation('/auth');
    });
  }, [setLocation]);

  const handleRunAnalysis = async () => {
    runAnalysis.mutate(undefined, {
      onSuccess: (data) => {
        toast.success('Analysis started');
        setLocation(`/analysis/${data.id}`);
      },
      onError: (error) => {
        toast.error('Failed to start analysis', { description: error.message });
      }
    });
  };

  if (githubLoading) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-8 w-64 mb-8" />
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  if (!githubStatus?.connected) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>GitHub Not Connected</CardTitle>
            <CardDescription>Please connect your GitHub account to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => signInWithGitHub()} data-testid="button-connect-github">
              Connect GitHub
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark">
      <AppHeader
        section="Portfolio"
        user={{
          login: githubStatus.login,
          displayName: githubStatus.displayName,
          avatarUrl: githubStatus.avatarUrl,
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="text-xs uppercase tracking-wide">Repositories</CardDescription>
              <CardTitle className="text-3xl font-bold">
                {portfolioLoading ? <Skeleton className="h-9 w-16" /> : portfolio?.repoCount || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="text-xs uppercase tracking-wide">Total Stars</CardDescription>
              <CardTitle className="text-3xl font-bold">
                {portfolioLoading ? <Skeleton className="h-9 w-16" /> : portfolio?.totalStars || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="text-xs uppercase tracking-wide">Languages</CardDescription>
              <CardTitle className="text-3xl font-bold">
                {portfolioLoading ? <Skeleton className="h-9 w-16" /> : portfolio?.languages.length || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="text-xs uppercase tracking-wide">Analyses</CardDescription>
              <CardTitle className="text-3xl font-bold">
                {analysesLoading ? <Skeleton className="h-9 w-16" /> : analyses?.length || 0}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {!portfolioLoading && portfolio && portfolio.languages.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Languages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {portfolio.languages.slice(0, 10).map(lang => (
                  <Badge key={lang.name} variant="secondary" className="font-mono text-xs">
                    {lang.name} <span className="ml-1 text-muted-foreground">({lang.count})</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <CardTitle>Run New Analysis</CardTitle>
            <CardDescription>
              Analyze the portfolio, rank completion and value, then finish individual repositories with one autonomous action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleRunAnalysis}
              disabled={runAnalysis.isPending}
              size="lg"
              data-testid="button-run-analysis"
            >
              {runAnalysis.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Start Analysis
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-2xl font-bold mb-4">Analysis History</h2>
          {analysesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : analyses && analyses.length > 0 ? (
            <div className="grid gap-4">
              {analyses.map(analysis => (
                <Link key={analysis.id} href={`/analysis/${analysis.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer" data-testid={`card-analysis-${analysis.id}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            {analysis.status === 'running' && (
                              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Running
                              </Badge>
                            )}
                            {analysis.status === 'complete' && (
                              <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Complete
                              </Badge>
                            )}
                            {analysis.status === 'failed' && (
                              <Badge variant="destructive">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                Failed
                              </Badge>
                            )}
                            <span className="text-sm text-muted-foreground font-mono">
                              {formatDistanceToNow(new Date(analysis.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            {analysis.repo_count && (
                              <div className="flex items-center gap-1">
                                <Code className="w-4 h-4" />
                                {analysis.repo_count} repos
                              </div>
                            )}
                            {analysis.ai_provider && <div className="font-mono text-xs">{analysis.ai_provider}</div>}
                          </div>
                          {analysis.error && analysis.status === 'running' && (
                            <p className="text-sm text-muted-foreground italic break-words">{analysis.error}</p>
                          )}
                          {analysis.error && analysis.status === 'failed' && (
                            <p className="text-sm text-destructive break-words">{analysis.error}</p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleDelete(e, analysis.id)}
                          disabled={deleteAnalysis.isPending}
                          data-testid={`button-delete-analysis-${analysis.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <p className="text-muted-foreground">No analyses yet. Run your first analysis to get started.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
