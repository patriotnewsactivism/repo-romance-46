import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, CheckCircle2, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

type RunStatus = 'queued' | 'running' | 'complete' | 'partial_failed' | 'failed' | 'cancelled';

interface RunListItem {
  id: string;
  status: RunStatus;
  total_repos: number;
  deep_limit: number;
  council_limit: number;
  completed_count: number;
  failed_count: number;
  progress_message: string | null;
  summary: TierSummary | null;
  created_at: string;
  updated_at: string;
}

interface TierItem {
  id: string;
  repo: string;
  initial_rank: number;
  initial_finish_first_score: number;
  target_depth: 'deep_source' | 'council';
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  refined_score: number | null;
  confidence: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface TierSummary {
  methodologyVersion: string;
  generatedAt: string;
  tier1: { repositories: number; coveragePct: number };
  tier2: { requested: number; completed: number; coveragePct: number };
  tier3: { requested: number; completed: number; coveragePct: number };
  averageDeepConfidence: number;
  failedCandidates: Array<{ repo: string; error: string }>;
  topRefined: Array<{
    repo: string;
    initialRank: number;
    depth: string;
    refinedScore: number;
    confidence: number;
    result?: Record<string, unknown>;
  }>;
  costPolicy: string;
}

interface TierDetail {
  run: RunListItem;
  items: TierItem[];
}

const ACTIVE = new Set<RunStatus>(['queued', 'running']);

async function postJson<T>(path: string, body?: unknown) {
  return customFetch<T>(path, {
    method: 'POST',
    responseType: 'json',
    body: JSON.stringify(body ?? {}),
  });
}

function resultString(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return typeof value === 'string' ? value : '';
}

export function TieredIntelligencePanel({ analysisId, repoCount }: { analysisId: string; repoCount: number }) {
  const [deepLimit, setDeepLimit] = useState(String(Math.min(30, Math.max(1, repoCount))));
  const [councilLimit, setCouncilLimit] = useState(String(Math.min(8, Math.max(0, repoCount))));
  const [detail, setDetail] = useState<TierDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const active = Boolean(detail && ACTIVE.has(detail.run.status));
  const progress = useMemo(() => {
    if (!detail || detail.run.deep_limit <= 0) return 0;
    return Math.min(100, Math.round(((detail.run.completed_count + detail.run.failed_count) / detail.run.deep_limit) * 100));
  }, [detail]);

  const refresh = async (runId: string) => {
    const next = await customFetch<TierDetail>(`/api/portfolio-intelligence/tiered-runs/${runId}`, { responseType: 'json' });
    setDetail(next);
    setError(null);
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    customFetch<RunListItem[]>(`/api/portfolio-intelligence/${analysisId}/tiered`, { responseType: 'json' })
      .then(async (runs) => {
        if (cancelled || runs.length === 0) return;
        const run = runs.find((candidate) => ACTIVE.has(candidate.status)) ?? runs[0];
        const next = await refresh(run.id);
        if (!cancelled) setDetail(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load tiered intelligence.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  useEffect(() => {
    if (!detail || !ACTIVE.has(detail.run.status)) return;
    const timer = window.setInterval(() => void refresh(detail.run.id).catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.run.id, detail?.run.status]);

  const start = async () => {
    const deep = Math.min(repoCount, Math.max(1, Number(deepLimit) || 30));
    const council = Math.min(deep, Math.max(0, Number(councilLimit) || 0));
    setStarting(true);
    setError(null);
    try {
      const next = await postJson<TierDetail>(`/api/portfolio-intelligence/${analysisId}/tiered`, {
        deepLimit: deep,
        councilLimit: council,
      });
      setDetail(next);
      toast.success(`Tiered intelligence started: all ${repoCount} repos stay covered, top ${deep} get source analysis, top ${council} get council-depth reasoning.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start tiered intelligence.';
      setError(message);
      toast.error(message.slice(0, 240));
    } finally {
      setStarting(false);
    }
  };

  const summary = detail?.run.summary;

  return (
    <Card className="p-4 sm:p-5 space-y-4 border-violet-500/20 overflow-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-500" />
            <h3 className="font-semibold">Tiered Intelligence</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep fast deterministic coverage across the whole portfolio, then spend deeper AI reasoning only where it can change the investment decision. This scales to large portfolios without treating every repository like a heavyweight research job.
          </p>
        </div>
        {detail && (
          <Button variant="ghost" size="sm" onClick={() => void refresh(detail.run.id)} disabled={loading} className="gap-2 shrink-0">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        )}
      </div>

      {!active && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Deep source candidates
            <input type="number" min="1" max={Math.min(100, repoCount)} value={deepLimit} onChange={(event) => setDeepLimit(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Council-depth candidates
            <input type="number" min="0" max={Math.min(25, repoCount)} value={councilLimit} onChange={(event) => setCouncilLimit(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <div className="flex items-end">
            <Button onClick={start} disabled={starting || repoCount === 0} className="w-full gap-2 h-10">
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {starting ? 'Starting…' : detail ? 'Run fresh tiered analysis' : 'Deepen top candidates'}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 break-words">{error}</p>}

      {detail && (
        <div className="space-y-3">
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Tier 1 coverage</div><div className="font-semibold">{detail.run.total_repos}/{detail.run.total_repos}</div><div className="text-[11px] text-muted-foreground">100% structural</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Deep source</div><div className="font-semibold">{detail.run.completed_count}/{detail.run.deep_limit}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Council target</div><div className="font-semibold">Top {detail.run.council_limit}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Failures</div><div className="font-semibold">{detail.run.failed_count}</div></div>
            <div className="rounded border p-3 col-span-2 lg:col-span-1"><div className="text-xs text-muted-foreground">Status</div><div className="font-semibold capitalize">{detail.run.status.replace('_', ' ')}</div></div>
          </div>

          {active && (
            <>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} /></div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{detail.run.progress_message || 'Deepening the highest-value candidates…'}</div>
            </>
          )}

          {summary && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Tier 1</div><div className="font-semibold">{summary.tier1.coveragePct}%</div><div className="text-[11px] text-muted-foreground">{summary.tier1.repositories} repos</div></div>
                <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Tier 2 deep</div><div className="font-semibold">{summary.tier2.completed}/{summary.tier2.requested}</div><div className="text-[11px] text-muted-foreground">{summary.tier2.coveragePct}% portfolio</div></div>
                <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Tier 3 council</div><div className="font-semibold">{summary.tier3.completed}/{summary.tier3.requested}</div><div className="text-[11px] text-muted-foreground">Avg confidence {summary.averageDeepConfidence}/100</div></div>
              </div>
              <p className="text-xs text-muted-foreground">{summary.costPolicy}</p>
              {summary.topRefined.length > 0 && (
                <div className="rounded border divide-y overflow-hidden">
                  {summary.topRefined.slice(0, 10).map((item, index) => (
                    <div key={item.repo} className="p-3 flex items-start gap-3">
                      <div className="font-mono text-xs text-muted-foreground w-6">#{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium break-all">{item.repo}</span>
                          <Badge variant="outline">{item.depth === 'council' ? 'Council' : 'Deep'}</Badge>
                        </div>
                        {resultString(item.result, 'summary') && <p className="mt-1 text-xs text-muted-foreground">{resultString(item.result, 'summary')}</p>}
                      </div>
                      <div className="text-right shrink-0"><div className="font-bold">{item.refinedScore}</div><div className="text-[10px] text-muted-foreground">refined</div></div>
                    </div>
                  ))}
                </div>
              )}
              {summary.failedCandidates.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-600"><TriangleAlert className="h-4 w-4 shrink-0" />{summary.failedCandidates.length} candidate(s) kept their Tier 1 score because deeper enrichment failed.</div>
              )}
              {detail.run.status === 'complete' && <div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />Tiered intelligence complete.</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
