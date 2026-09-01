import { useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import { useGetAnalysis, getGetAnalysisQueryKey, useShareAnalysis, useRerunAnalysis } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signInWithGitHub } from '@/lib/auth';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RecommendationCard } from '@/components/recommendation-card';
import { StrategyView } from '@/components/strategy-view';
import { ActionPlanView } from '@/components/action-plan-view';
import { ValuationView } from '@/components/valuation-view';
import { InvestmentIntelligenceView } from '@/components/investment-intelligence-view';
import { Loader2, Brain, Layers, Sparkles, Search, Zap, Share2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function AnalysisDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const analysisId = params.id as string;

  const { data: detail, isLoading } = useGetAnalysis(analysisId);
  const shareAnalysis = useShareAnalysis();
  const rerunAnalysis = useRerunAnalysis();
  const pollInterval = useRef<number | null>(null);

  useEffect(() => {
    getSession().then(session => {
      if (!session) setLocation('/auth');
    });
  }, [setLocation]);

  useEffect(() => {
    if (detail?.analysis.status === 'running') {
      pollInterval.current = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysisId) });
      }, 10000);
    } else if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [detail?.analysis.status, analysisId, queryClient]);

  const handleShareToggle = async (isPublic: boolean) => {
    shareAnalysis.mutate(
      { id: analysisId, data: { isPublic } },
      {
        onSuccess: () => {
          toast.success(isPublic ? 'Analysis is now public' : 'Analysis is now private');
          queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysisId) });
        },
        onError: (error) => toast.error('Failed to update sharing', { description: error.message }),
      }
    );
  };

  const handleRerun = async () => {
    rerunAnalysis.mutate(
      { id: analysisId },
      {
        onSuccess: (data) => {
          toast.success('Started new analysis');
          setLocation(`/analysis/${data.id}`);
        },
        onError: (error) => toast.error('Failed to rerun analysis', { description: error.message }),
      }
    );
  };

  const copyShareLink = () => {
    if (detail?.analysis.share_slug) {
      const url = `${window.location.origin}${import.meta.env.BASE_URL}s/${detail.analysis.share_slug}`;
      navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    }
  };

  const getStageIcon = (error: string) => {
    const lower = error.toLowerCase();
    if (lower.includes('profil')) return Brain;
    if (lower.includes('strategy') || lower.includes('digest')) return Layers;
    if (lower.includes('running') || lower.includes('analyz')) return Sparkles;
    if (lower.includes('critiqu')) return Search;
    if (lower.includes('synthe')) return Zap;
    return Loader2;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="border-b border-border bg-background/95">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-64 mb-8" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Analysis Not Found</CardTitle>
            <CardDescription>The requested analysis could not be found</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard"><Button>Back to Dashboard</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { analysis, items } = detail;
  const StageIcon = analysis.error && analysis.status === 'running' ? getStageIcon(analysis.error) : Loader2;
  const githubAuthFailed = analysis.status === 'failed' && Boolean(
    analysis.error && /bad credentials|github[^\n]*401|expired|revoked|connect github/i.test(analysis.error),
  );

  return (
    <div className="min-h-screen bg-background dark">
      <AppHeader
        section="Analysis"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRerun}
            disabled={rerunAnalysis.isPending || analysis.status === 'running'}
            data-testid="button-rerun"
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${rerunAnalysis.isPending ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Rerun</span>
          </Button>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {analysis.status === 'running' && (
          <Card className="border-primary/40 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <StageIcon className="w-5 h-5 text-primary animate-pulse shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">Analysis in progress</p>
                  {analysis.error && <p className="text-sm text-muted-foreground mt-1 break-words">{analysis.error}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {analysis.status === 'failed' && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-6 space-y-3">
              <p className="font-semibold text-destructive">Analysis failed</p>
              {githubAuthFailed ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    GitHub authorization expired or was revoked. Reconnect GitHub, then rerun this analysis.
                  </p>
                  <Button onClick={() => signInWithGitHub()} data-testid="button-reconnect-github">
                    Reconnect GitHub
                  </Button>
                </>
              ) : (
                analysis.error && <p className="text-sm text-muted-foreground break-words">{analysis.error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {analysis.status === 'complete' && (
          <Tabs defaultValue="recommendations" className="space-y-6">
            <div className="w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="inline-flex h-auto min-w-max items-center justify-start gap-1 p-1">
                <TabsTrigger value="recommendations" data-testid="tab-recommendations" className="shrink-0">
                  Recommendations
                  {items.length > 0 && (
                    <Badge variant="secondary" className="ml-2 font-mono text-xs">{items.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="strategy" data-testid="tab-strategy" className="shrink-0">Strategy</TabsTrigger>
                <TabsTrigger value="action-plan" data-testid="tab-action-plan" className="shrink-0">Action Plan</TabsTrigger>
                <TabsTrigger value="investment" data-testid="tab-investment" className="shrink-0">Finish, Value & Reports</TabsTrigger>
                <TabsTrigger value="valuation" data-testid="tab-valuation" className="shrink-0">Legacy Valuation</TabsTrigger>
                <TabsTrigger value="share" data-testid="tab-share" className="shrink-0">
                  <Share2 className="w-4 h-4 mr-1" />
                  Share
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="recommendations" className="space-y-4">
              {items.length > 0 ? (
                items.map(item => (
                  <RecommendationCard key={item.id} recommendation={item} analysisId={analysisId} />
                ))
              ) : (
                <Card>
                  <CardContent className="pt-12 pb-12 text-center">
                    <p className="text-muted-foreground">No recommendations found in this analysis</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="strategy"><StrategyView analysis={analysis} /></TabsContent>
            <TabsContent value="action-plan"><ActionPlanView analysisId={analysisId} /></TabsContent>
            <TabsContent value="investment"><InvestmentIntelligenceView analysisId={analysisId} /></TabsContent>
            <TabsContent value="valuation"><ValuationView analysisId={analysisId} /></TabsContent>

            <TabsContent value="share">
              <Card>
                <CardHeader>
                  <CardTitle>Public Sharing</CardTitle>
                  <CardDescription>Make this analysis publicly accessible via a shareable link</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="public-toggle" className="cursor-pointer min-w-0">
                      <div className="font-semibold mb-1">Public access</div>
                      <div className="text-sm text-muted-foreground">Anyone with the link can view this analysis</div>
                    </Label>
                    <Switch
                      id="public-toggle"
                      checked={analysis.is_public || false}
                      onCheckedChange={handleShareToggle}
                      disabled={shareAnalysis.isPending}
                      data-testid="switch-public-share"
                    />
                  </div>

                  {analysis.is_public && analysis.share_slug && (
                    <div className="space-y-3">
                      <div className="p-4 bg-muted rounded-lg font-mono text-sm break-all">
                        {`${window.location.origin}${import.meta.env.BASE_URL}s/${analysis.share_slug}`}
                      </div>
                      <Button onClick={copyShareLink} variant="outline" className="w-full" data-testid="button-copy-link">
                        Copy Link
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
