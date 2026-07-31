import { useState } from 'react';
import { useGetActionPlan } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Calendar, Target } from 'lucide-react';
import { toast } from 'sonner';

interface ActionPlanViewProps {
  analysisId: string;
}

export function ActionPlanView({ analysisId }: ActionPlanViewProps) {
  const [requested, setRequested] = useState(false);
  const getActionPlan = useGetActionPlan();

  const handleGenerate = () => {
    setRequested(true);
    getActionPlan.mutate(
      { id: analysisId },
      {
        onError: (error) => {
          toast.error('Failed to generate action plan', { description: error.message });
          setRequested(false);
        }
      }
    );
  };

  if (!requested) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Calendar className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle>Generate Action Plan</CardTitle>
          <CardDescription className="max-w-md mx-auto">
            AI will create a phased roadmap prioritizing your recommendations by effort, market potential, and dependencies
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={handleGenerate} size="lg" data-testid="button-generate-action-plan">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (getActionPlan.isPending) {
    return (
      <Card>
        <CardContent className="pt-12 pb-12 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Generating your phased action plan...</p>
        </CardContent>
      </Card>
    );
  }

  if (!getActionPlan.data) {
    return null;
  }

  const plan = getActionPlan.data;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Action Plan Overview
          </CardTitle>
          <CardDescription>
            Total timeline: <span className="font-semibold">{plan.total_weeks} weeks</span>
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Quick Wins */}
      {plan.quick_wins && plan.quick_wins.length > 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="w-5 h-5 text-green-500" />
              Quick Wins
            </CardTitle>
            <CardDescription>High-impact, low-effort items to start immediately</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {plan.quick_wins.map((win, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-green-500">•</span>
                  <span className="text-muted-foreground">{win}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Phases */}
      {plan.phases.map((phase, phaseIndex) => (
        <Card key={phaseIndex}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg">
                  Phase {phaseIndex + 1}: {phase.name}
                </CardTitle>
                <CardDescription className="mt-1">
                  {phase.duration_weeks} {phase.duration_weeks === 1 ? 'week' : 'weeks'}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {phase.items.length} {phase.items.length === 1 ? 'item' : 'items'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase.items.map((item, itemIndex) => (
              <div key={itemIndex} className="p-4 border border-border rounded-lg space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <h4 className="font-semibold flex-1">{item.title}</h4>
                  <Badge variant="outline" className="font-mono text-xs">
                    #{item.recommendation_index}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Why now:</span> {item.why_now}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Key deliverable:</span> {item.key_deliverable}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Moonshots */}
      {plan.moonshots && plan.moonshots.length > 0 && (
        <Card className="border-chart-2/20 bg-chart-2/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-chart-2" />
              Moonshots
            </CardTitle>
            <CardDescription>Ambitious long-term opportunities to consider after core work</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {plan.moonshots.map((shot, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-chart-2">•</span>
                  <span className="text-muted-foreground">{shot}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
