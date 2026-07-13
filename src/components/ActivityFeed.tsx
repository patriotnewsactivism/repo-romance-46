import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActivityFeed, getActivityStats } from "@/lib/activity-feed.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  GitBranch,
  Brain,
  Search,
  Shield,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

const KIND_ICONS: Record<string, typeof Activity> = {
  analysis_started: Search,
  analysis_completed: Search,
  deep_analysis: Search,
  finish_pr_created: GitBranch,
  finish_pr_merged: GitBranch,
  step_completed: CheckCircle2,
  step_failed: XCircle,
  ci_passed: Shield,
  ci_failed: Shield,
  sequence_started: Zap,
  sequence_completed: Zap,
  sequence_stopped: Zap,
  autonomous_decision: Brain,
  autonomous_job: Brain,
  learning_logged: Info,
  pattern_detected: Info,
  scope_violation: AlertTriangle,
  safety_rail_triggered: AlertTriangle,
  swarm_started: Zap,
  swarm_completed: Zap,
  dependency_alert: AlertTriangle,
};

const STATUS_STYLES: Record<string, string> = {
  success: "text-green-500",
  warning: "text-yellow-500",
  error: "text-red-500",
  info: "text-blue-500",
};

interface ActivityEvent {
  id: string;
  kind: string;
  repo: string | null;
  title: string;
  detail: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function ActivityFeed({ repo }: { repo?: string }) {
  const feedFn = useServerFn(getActivityFeed);
  const statsFn = useServerFn(getActivityStats);
  const [limit] = useState(20);

  const feedQuery = useQuery({
    queryKey: ["activity-feed", repo, limit],
    queryFn: () => feedFn({ data: { repo, limit } }),
    refetchInterval: 15000,
  });

  const statsQuery = useQuery({
    queryKey: ["activity-stats"],
    queryFn: () => statsFn({}),
    refetchInterval: 30000,
  });

  const events = (feedQuery.data as { events: ActivityEvent[] } | undefined)?.events ?? [];
  const stats = statsQuery.data as {
    last24h: number;
    byStatus: { success: number; warning: number; error: number; info: number };
  } | undefined;

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-mono text-sm font-semibold">activity feed</h3>
        </div>
        {stats && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">24h:</span>
            {stats.byStatus.success > 0 && (
              <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px] px-1">
                {stats.byStatus.success} ✓
              </Badge>
            )}
            {stats.byStatus.error > 0 && (
              <Badge variant="outline" className="text-red-500 border-red-500/30 text-[10px] px-1">
                {stats.byStatus.error} ✗
              </Badge>
            )}
            {stats.byStatus.warning > 0 && (
              <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 text-[10px] px-1">
                {stats.byStatus.warning} ⚠
              </Badge>
            )}
          </div>
        )}
      </div>

      {events.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No activity yet. Run an analysis or finish a repo to see events here.
        </p>
      )}

      <div className="space-y-1">
        {events.map((event) => {
          const IconComp = KIND_ICONS[event.kind] ?? Info;
          const statusClass = STATUS_STYLES[event.status] ?? STATUS_STYLES.info;

          return (
            <div key={event.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
              <IconComp className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${statusClass}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{event.title}</span>
                  {event.repo && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {event.repo.split("/").pop()}
                    </span>
                  )}
                </div>
                {event.detail && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {event.detail}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {relativeTime(event.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
