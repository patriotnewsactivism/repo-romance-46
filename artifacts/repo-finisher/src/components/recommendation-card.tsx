import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useGetMergeInstructions } from '@workspace/api-client-react';
import { Recommendation } from '@workspace/api-client-react';
import { ChevronDown, ChevronUp, Target, Zap, GitMerge, Loader2, Twitter, Linkedin } from 'lucide-react';
import { toast } from 'sonner';
import { FinishRepoAction } from '@/components/finish-repo-action';
import { VibeToolsPanel } from '@/components/vibe-tools-panel';

interface RecommendationCardProps {
  recommendation: Recommendation;
  analysisId: string;
  /** True on the unauthenticated public share page — hides actions that require a session. */
  isPublic?: boolean;
}

export function RecommendationCard({ recommendation, analysisId, isPublic = false }: RecommendationCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const getMergeInstructions = useGetMergeInstructions();

  const kindColors = {
    finish: 'bg-green-500/10 text-green-500 border-green-500/20',
    combine: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
    repurpose: 'bg-chart-3/10 text-chart-3 border-chart-3/20',
  };

  const effortBars = Array.from({ length: 5 }, (_, i) => i < recommendation.effort);
  const marketBars = Array.from({ length: 5 }, (_, i) => i < recommendation.market_potential);

  const handleGetMergeInstructions = async () => {
    setShowMerge(true);
    getMergeInstructions.mutate(
      { id: analysisId, data: { itemRank: recommendation.rank } },
      {
        onError: (error) => {
          toast.error('Failed to generate merge instructions', { description: error.message });
          setShowMerge(false);
        }
      }
    );
  };

  return (
    <Card className="hover:border-primary/40 transition-colors" data-testid={`card-recommendation-${recommendation.rank}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className={`font-mono text-xs uppercase ${kindColors[recommendation.kind]}`}>
                {recommendation.kind}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                #{recommendation.rank}
              </Badge>
            </div>
            <CardTitle className="text-xl leading-tight">{recommendation.title}</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            data-testid={`button-expand-${recommendation.rank}`}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground leading-relaxed">{recommendation.pitch}</p>

        {/* Repos */}
        <div className="flex flex-wrap gap-2">
          {recommendation.repos.map(repo => (
            <Badge key={repo} variant="outline" className="font-mono text-xs">
              {repo}
            </Badge>
          ))}
        </div>

        {/* Scores */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              Effort
            </div>
            <div className="flex gap-1">
              {effortBars.map((filled, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${filled ? 'bg-primary' : 'bg-muted'}`}
                />
              ))}
            </div>
            {recommendation.estimated_hours && (
              <p className="text-xs text-muted-foreground font-mono">
                ~{recommendation.estimated_hours}h
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-muted-foreground" />
              Market Potential
            </div>
            <div className="flex gap-1">
              {marketBars.map((filled, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${filled ? 'bg-chart-3' : 'bg-muted'}`}
                />
              ))}
            </div>
          </div>
        </div>

        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleContent className="space-y-4 pt-4 border-t border-border">
            {/* Next Steps */}
            {recommendation.next_steps && recommendation.next_steps.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Next Steps</h4>
                <ul className="space-y-1">
                  {recommendation.next_steps.map((step, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2">
                      <span className="text-primary font-mono">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tech Stack */}
            {recommendation.tech_stack && recommendation.tech_stack.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Tech Stack</h4>
                <div className="flex flex-wrap gap-2">
                  {recommendation.tech_stack.map(tech => (
                    <Badge key={tech} variant="secondary" className="font-mono text-xs">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Marketing Copy */}
            {(recommendation.marketing_tweet || recommendation.marketing_linkedin) && (
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Marketing Copy</h4>
                
                {recommendation.marketing_tweet && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Twitter className="w-3 h-3" />
                      <span>Twitter/X</span>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-sm leading-relaxed">
                      {recommendation.marketing_tweet}
                    </div>
                  </div>
                )}

                {recommendation.marketing_linkedin && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Linkedin className="w-3 h-3" />
                      <span>LinkedIn</span>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-sm leading-relaxed">
                      {recommendation.marketing_linkedin}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* One-click finish */}
            {!isPublic && (recommendation.kind === 'finish' || recommendation.kind === 'repurpose') && (
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Auto-Finish</h4>
                {recommendation.repos.map((repo) => (
                  <FinishRepoAction
                    key={repo}
                    repo={repo}
                    nextSteps={recommendation.next_steps}
                    analysisId={analysisId}
                    itemRank={recommendation.rank}
                    initialResult={recommendation.finish_result}
                  />
                ))}
              </div>
            )}

            {/* Merge Instructions */}
            {!isPublic && recommendation.kind === 'combine' && (
              <div className="space-y-3">
                {!showMerge ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGetMergeInstructions}
                    data-testid={`button-merge-${recommendation.rank}`}
                  >
                    <GitMerge className="w-4 h-4 mr-2" />
                    Get Merge Instructions
                  </Button>
                ) : getMergeInstructions.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating merge instructions...
                  </div>
                ) : getMergeInstructions.data ? (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Merge Instructions</h4>
                    <div className="space-y-2">
                      <div className="text-sm">
                        <span className="text-muted-foreground">New repo name:</span>{' '}
                        <span className="font-mono font-semibold">{getMergeInstructions.data.newRepoName}</span>
                      </div>
                      {getMergeInstructions.data.primaryRepo && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Primary repo:</span>{' '}
                          <span className="font-mono">{getMergeInstructions.data.primaryRepo}</span>
                        </div>
                      )}
                      <div className="p-4 bg-muted rounded-lg text-sm font-mono whitespace-pre-wrap leading-relaxed">
                        {getMergeInstructions.data.instructions}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {!isPublic && (
              <VibeToolsPanel
                analysisId={analysisId}
                itemRank={recommendation.rank}
                kind={recommendation.kind}
                repos={recommendation.repos}
                existing={{
                  market_analysis: recommendation.market_analysis,
                  valuation: recommendation.valuation,
                  vibe_spec: recommendation.vibe_spec,
                  combine_result: recommendation.combine_result,
                  finish_history: recommendation.finish_history,
                }}
              />
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
