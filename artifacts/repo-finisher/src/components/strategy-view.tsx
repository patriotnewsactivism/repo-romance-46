import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnalysisDetailAnalysis } from '@workspace/api-client-react';
import { Brain, Layers, Search } from 'lucide-react';

interface StrategyViewProps {
  analysis: AnalysisDetailAnalysis;
}

export function StrategyView({ analysis }: StrategyViewProps) {
  const strategy = analysis.portfolio_stats?._strategy as any;
  
  const developerProfile = analysis.developer_profile || strategy?.developer_profile;
  const domainClusters = strategy?.domain_clusters || [];
  const strategySummary = analysis.strategy_summary || strategy?.strategy_summary;
  const critiqueSummary = analysis.critique_md || strategy?.critique_summary;
  const analysisTier = strategy?.analysis_tier;
  const profilerModel = strategy?.profiler_model;
  const synthesisModel = strategy?.synthesis_model;

  return (
    <div className="space-y-6">
      {/* Model Info */}
      {(analysisTier || profilerModel || synthesisModel) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              Analysis Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysisTier && (
              <div>
                <span className="text-sm text-muted-foreground">Tier:</span>{' '}
                <Badge variant="secondary" className="font-mono text-xs uppercase ml-2">
                  {analysisTier}
                </Badge>
              </div>
            )}
            {profilerModel && (
              <div className="text-sm">
                <span className="text-muted-foreground">Profiler model:</span>{' '}
                <span className="font-mono">{profilerModel}</span>
              </div>
            )}
            {synthesisModel && (
              <div className="text-sm">
                <span className="text-muted-foreground">Synthesis model:</span>{' '}
                <span className="font-mono">{synthesisModel}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Developer Profile */}
      {developerProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Developer Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground leading-relaxed">{developerProfile}</p>
          </CardContent>
        </Card>
      )}

      {/* Domain Clusters */}
      {domainClusters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Domain Clusters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {domainClusters.map((cluster: any, i: number) => (
              <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                <div>
                  <h4 className="font-semibold">{cluster.name}</h4>
                  {cluster.theme && (
                    <p className="text-sm text-muted-foreground mt-1">{cluster.theme}</p>
                  )}
                </div>
                {cluster.repos && cluster.repos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {cluster.repos.map((repo: string) => (
                      <Badge key={repo} variant="outline" className="font-mono text-xs">
                        {repo}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Strategy Summary */}
      {strategySummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Strategy Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{strategySummary}</p>
          </CardContent>
        </Card>
      )}

      {/* Critique */}
      {critiqueSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="w-5 h-5 text-primary" />
              Self-Critique Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm prose-invert max-w-none">
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{critiqueSummary}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analyzed Repos */}
      {analysis.analyzed_repo_names && analysis.analyzed_repo_names.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Analyzed Repositories ({analysis.analyzed_repo_names.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analysis.analyzed_repo_names.map(repo => (
                <Badge key={repo} variant="outline" className="font-mono text-xs">
                  {repo}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
