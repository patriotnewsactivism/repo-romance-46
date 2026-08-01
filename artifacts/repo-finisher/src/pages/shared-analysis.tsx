import { useParams, Link } from 'wouter';
import { useGetPublicAnalysis, ApiError } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RecommendationCard } from '@/components/recommendation-card';
import { StrategyView } from '@/components/strategy-view';
import { GitBranch, Lock } from 'lucide-react';

export default function SharedAnalysis() {
  const params = useParams();
  const slug = params.slug as string;
  const { data: detail, isLoading, error } = useGetPublicAnalysis(slug);

  const errorMessage =
    error instanceof ApiError && error.status === 404
      ? 'Analysis not found or not public'
      : error
        ? 'Failed to load analysis'
        : null;

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

  if (errorMessage || !detail) {
    return (
      <div className="min-h-screen bg-background dark flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <Lock className="w-8 h-8 text-muted-foreground" />
              </div>
            </div>
            <CardTitle>Analysis Not Available</CardTitle>
            <CardDescription>{errorMessage || 'This analysis is private or does not exist'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button className="w-full">Go to RepoFinisher</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { analysis, items } = detail;

  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2">
                <GitBranch className="w-6 h-6 text-primary" />
                <span className="font-bold text-xl">RepoFinisher</span>
              </Link>
              <div className="h-6 w-px bg-border" />
              <span className="text-sm text-muted-foreground">Shared Analysis</span>
            </div>
            <Link href="/auth">
              <Button variant="outline" size="sm">
                Create Your Own
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Recommendations */}
        {items.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Recommendations ({items.length})</h2>
            {items.map(item => (
              <RecommendationCard 
                key={item.id} 
                recommendation={item} 
                analysisId={analysis.id}
              />
            ))}
          </div>
        )}

        {/* Strategy */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Analysis Strategy</h2>
          <StrategyView analysis={analysis} />
        </div>

        {/* CTA */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent text-center">
          <CardHeader>
            <CardTitle>Want insights like these for your repos?</CardTitle>
            <CardDescription>
              Connect your GitHub and get AI-powered product opportunities in minutes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/auth">
              <Button size="lg">
                Get Started Free
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
