import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useGetGithubStatus,
  useGetPortfolioSummary,
  useListAnalyses,
  useRunAnalysis,
  useDeleteAnalysis,
  getListAnalysesQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signInWithGitHub, signOut } from '@/lib/auth';
import { AppHeader } from '@/components/app-header';
import { PortfolioRepoBrowser } from '@/components/portfolio-repo-browser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PortfolioIntelligenceSnapshot } from '@/lib/portfolio-types';
import { Plus, Code, AlertCircle, CheckCircle, Loader2, Trash2, Settings2 } from 'lucide-react';
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

  const [activeTab, setActiveTab] = useState('repos');
  const [snapshot, setSnapshot] = useState<PortfolioIntelligenceSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotRefreshing, setSnapshotRefreshing] = useState(false);

  const latestCompletedAnalysis = useMemo(
    () => analyses?.find((analysis) => analysis.status === 'complete') ?? null,
    [analyses],
  );

  const loadSnapshot = async (analysisId: string, mode: 'get' | 'post' = 'get') => {
    if (mode === 'get') setSnapshotLoading(true);
    else setSnapshotRefreshing(true);
    try {
      const result = await customFetch<PortfolioIntelligenceSnapshot | null>(
        `/api/portfolio-intelligence/${analysisId}`,
        {
          method: mode === 'post' ? 'POST' : 'GET',
          responseType: 'json',
          ...(mode === 'post' ? { body: JSON.stringify({}) } : {}),
        },
      );
      setSnapshot(result);
      if (mode === 'post' && result) {
        toast.success(`Scored ${result.portfolio.reposScored} repositories`);
      }
    } catch (error) {
      if (mode === 'post') {
        toast.error('Failed to score portfolio', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      if (mode === 'get') setSnapshot(null);
    } finally {
      setSnapshotLoading(false);
      setSnapshotRefreshing(false);
    }
  };

  useEffect(() => {
    getSession().then((session) => {
      if (!session) setLocation('/auth');
    });
  }, [setLocation]);

  useEffect(() => {
    if (!latestCompletedAnalysis?.id) {
      setSnapshot(null);
      return;
    }
    void loadSnapshot(latestCompletedAnalysis.id, 'get');
  }, [latestCompletedAnalysis?.id]);

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

  const handleRunAnalysis = async () => {
    runAnalysis.mutate(undefined, {
      onSuccess: (data) => {
        toast.success('Portfolio scan started');
        setLocation(`/analysis/${data.id}`);
      },
      onError: (error) => {
        toast.error('Failed to start analysis', { description: error.message });
      },
    });
  };

  const handleSignOut = async () => {
    await signOut();
    setLocation('/auth');
  };

  if (githubLoading) {
    return (
      <div className="min-h-screen bg-background dark">
        <AppHeader section="Portfolio" onSignOut={() => void handleSignOut()} />
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
      <div className="min-h-screen bg-background dark">
        <AppHeader section="Portfolio" onSignOut={() => void handleSignOut()} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex justify-center">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle>GitHub Not Connected</CardTitle>
              <CardDescription>
                Connect GitHub with repo write access so analysis and draft PRs can run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full" onClick={() => signInWithGitHub()} data-testid="button-connect-github">
                Connect GitHub
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLocation('/settings')}>
                Open Settings
              </Button>
            </CardContent>
          </Card>
        </div>
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
        onSignOut={() => void handleSignOut()}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Find repositories, grade them on completeness / uniqueness / demand / competition, and finish the
              strongest opportunities first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setLocation('/settings')} className="gap-2">
              <Settings2 className="h-4 w-4" />
              Discovery filters
            </Button>
            <Button
              onClick={handleRunAnalysis}
              disabled={runAnalysis.isPending}
              data-testid="button-run-analysis"
              className="gap-2"
            >
              {runAnalysis.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {runAnalysis.isPending ? 'Starting…' : 'Scan portfolio'}
            </Button>
          </div>
        </div>

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
              <CardDescription className="text-xs uppercase tracking-wide">Scored now</CardDescription>
              <CardTitle className="text-3xl font-bold">
                {snapshotLoading && !snapshot ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  snapshot?.portfolio.reposScored ?? 0
                )}
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

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-portfolio">
            <TabsTrigger value="repos">Repos</TabsTrigger>
            <TabsTrigger value="analyses">Analyses</TabsTrigger>
          </TabsList>

          <TabsContent value="repos" className="mt-4 space-y-4">
            {!latestCompletedAnalysis ? (
              <Card>
                <CardHeader>
                  <CardTitle>Scan your portfolio</CardTitle>
                  <CardDescription>
                    Run a portfolio scan to score repositories and unlock finish suggestions. Adjust discovery
                    filters in Settings first if you want a narrower set.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={handleRunAnalysis} disabled={runAnalysis.isPending} className="gap-2">
                    {runAnalysis.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Start portfolio scan
                  </Button>
                  <Button variant="outline" onClick={() => setLocation('/settings')}>
                    Configure discovery
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <PortfolioRepoBrowser
                analysisId={latestCompletedAnalysis.id}
                snapshot={snapshot}
                loading={snapshotLoading}
                refreshing={snapshotRefreshing}
                onRefreshScores={() => void loadSnapshot(latestCompletedAnalysis.id, 'post')}
              />
            )}
          </TabsContent>

          <TabsContent value="analyses" className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Analysis history</h2>
              <Button
                onClick={handleRunAnalysis}
                disabled={runAnalysis.isPending}
                size="sm"
                className="gap-2"
              >
                {runAnalysis.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                New scan
              </Button>
            </div>

            {analysesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : analyses && analyses.length > 0 ? (
              <div className="grid gap-4">
                {analyses.map((analysis) => (
                  <Link key={analysis.id} href={`/analysis/${analysis.id}`}>
                    <Card
                      className="hover:border-primary/40 transition-colors cursor-pointer"
                      data-testid={`card-analysis-${analysis.id}`}
                    >
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              {analysis.status === 'running' && (
                                <Badge
                                  variant="secondary"
                                  className="bg-primary/10 text-primary border-primary/20"
                                >
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Running
                                </Badge>
                              )}
                              {analysis.status === 'complete' && (
                                <Badge
                                  variant="secondary"
                                  className="bg-green-500/10 text-green-500 border-green-500/20"
                                >
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
                              {latestCompletedAnalysis?.id === analysis.id && (
                                <Badge variant="outline">Latest scored snapshot</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              {analysis.repo_count && (
                                <div className="flex items-center gap-1">
                                  <Code className="w-4 h-4" />
                                  {analysis.repo_count} repos
                                </div>
                              )}
                              {analysis.ai_provider && (
                                <div className="font-mono text-xs">{analysis.ai_provider}</div>
                              )}
                            </div>
                            {analysis.error && analysis.status === 'running' && (
                              <p className="text-sm text-muted-foreground italic break-words">
                                {analysis.error}
                              </p>
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
                  <p className="text-muted-foreground">
                    No analyses yet. Run your first portfolio scan to get started.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
