import { useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import { useGetAnalysis, getGetAnalysisQueryKey, useGetActionPlan, useShareAnalysis, useRerunAnalysis } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession } from '@/lib/auth';
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
import { GitBranch, ArrowLeft, Loader2, Brain, Layers, Sparkles, Search, Zap, Share2, RefreshCw, Settings } from 'lucide-react';
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
      if (!session) {
        setLocation('/auth');
      }
    });
  }, [setLocation]);

  // Poll for updates when running
  useEffect(() => {
    if (detail?.analysis.status === 'running') {
      pollInterval.current = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysisId) });
      }, 10000);
    } else {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
    }

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [detail?.analysis.status, analysisId, queryClient]);

  const handleShareToggle = async (isPublic: boolean) => {
    shareAnalysis.mutate(
      { id: analysisId, data: { isPublic } },
      {
        onSuccess: (result) => {
          toast.success(isPublic ? 'Analysis is now public' : 'Analysis is now private');
          queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysisId) });
        },
        onError: (error) => {
          toast.error('Failed to update sharing', { description: error.message });
        }
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
        onError: (error) => {
          toast.error('Failed to rerun analysis', { description: error.message });
        }
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
        <div className="border-b border-border bg-card/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Skeleton className="h-6 w-48" />
            </div>
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
      <div className="min-h-screen bg-background dark flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Analysis Not Found</CardTitle>
            <CardDescription>The requested analysis could not be found</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard">
              <Button>Back to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { analysis, items } = detail;
  const StageIcon = analysis.error && analysis.status === 'running' ? getStageIcon(analysis.error) : Loader2;

  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-primary" />
                <span className="font-semibold">Analysis</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRerun}
                disabled={rerunAnalysis.isPending || analysis.status === 'running'}
                data-testid="button-rerun"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Rerun
              </Button>
              <Link href="/settings">
                <Button variant="ghost" size="sm" data-testid="button-settings-header">
                  <Settings className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Status Banner */}
        {analysis.status === 'running' && (
          <Card className="border-primary/40 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <StageIcon className="w-5 h-5 text-primary animate-pulse" />
                <div>
                  <p className="font-semibold">Analysis in progress</p>
                  {analysis.error && (
                    <p className="text-sm text-muted-foreground mt-1">{analysis.error}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {analysis.status === 'failed' && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <p className="font-semibold text-destructive">Analysis failed</p>
              </div>
              {analysis.error && (
                <p className="text-sm text-muted-foreground mt-2">{analysis.error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Content */}
        {analysis.status === 'complete' && (
          <Tabs defaultValue="recommendations" className="space-y-6">
            <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
              <TabsTrigger value="recommendations" data-testid="tab-recommendations">
                Recommendations
                {items.length > 0 && (
                  <Badge variant="secondary" className="ml-2 font-mono text-xs">
                    {items.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="strategy" data-testid="tab-strategy">Strategy</TabsTrigger>
              <TabsTrigger value="action-plan" data-testid="tab-action-plan">Action Plan</TabsTrigger>
              <TabsTrigger value="valuation" data-testid="tab-valuation">Valuation</TabsTrigger>
              <TabsTrigger value="share" data-testid="tab-share">
                <Share2 className="w-4 h-4 mr-1" />
                Share
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recommendations" className="space-y-4">
              {items.length > 0 ? (
                items.map(item => (
                  <RecommendationCard 
                    key={item.id} 
                    recommendation={item} 
                    analysisId={analysisId}
                  />
                ))
              ) : (
                <Card>
                  <CardContent className="pt-12 pb-12 text-center">
                    <p className="text-muted-foreground">No recommendations found in this analysis</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="strategy">
              <StrategyView analysis={analysis} />
            </TabsContent>

            <TabsContent value="action-plan">
              <ActionPlanView analysisId={analysisId} />
            </TabsContent>

            <TabsContent value="valuation">
              <ValuationView analysisId={analysisId} />
            </TabsContent>

            <TabsContent value="share">
              <Card>
                <CardHeader>
                  <CardTitle>Public Sharing</CardTitle>
                  <CardDescription>
                    Make this analysis publicly accessible via a shareable link
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="public-toggle" className="cursor-pointer">
                      <div className="font-semibold mb-1">Public access</div>
                      <div className="text-sm text-muted-foreground">
                        Anyone with the link can view this analysis
                      </div>
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
