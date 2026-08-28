import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Rocket,
  Square,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

type PortfolioStatus = 'queued' | 'running' | 'verifying' | 'succeeded' | 'partial_failed' | 'failed' | 'cancelled';
type PortfolioItemStatus = 'queued' | 'planning' | 'executing' | 'verifying' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

interface PortfolioRunResponse {
  run: {
    id: string;
    analysisId: string | null;
    status: PortfolioStatus;
    selectionLimit: number;
    concurrency: number;
    maxEstimatedHours: number | null;
    maxEstimatedCostUsd: number | null;
    stopOnFailure: boolean;
    requestedCount: number;
    plannedCount: number;
    succeededCount: number;
    failedCount: number;
    verifyingCount: number;
    skippedCount: number;
    estimatedHoursSelected: number;
    estimatedCostSelected: number;
    autonomyAcknowledgedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: Array<{
    id: string;
    repo: string;
    rank: number;
    status: PortfolioItemStatus;
    estimatedHours: number | null;
    estimatedCostUsd: number | null;
    error: string | null;
    completionRunId: string | null;
    prNumber: number | null;
    prUrl: string | null;
    ciStatus: string | null;
    outcomeScore: number | null;
  }>;
}

interface RawPortfolioRun {
  id: string;
  status: PortfolioStatus;
}

interface PortfolioHealResponse {
  runId: string;
  scheduled: number;
  status: PortfolioStatus;
}

const ACTIVE = new Set<PortfolioStatus>(['queued', 'running', 'verifying']);

function money(value: number | null | undefined) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function itemIcon(status: PortfolioItemStatus) {
  if (status === 'succeeded') return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === 'skipped' || status === 'cancelled') return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
}

async function postJson<T>(path: string, body?: unknown) {
  return customFetch<T>(path, {
    method: 'POST',
    responseType: 'json',
    body: JSON.stringify(body ?? {}),
  });
}

export function PortfolioFinishControl({ analysisId, repoCount }: { analysisId: string; repoCount: number }) {
  const [selection, setSelection] = useState<'5' | '10' | '25' | 'all'>('5');
  const [concurrency, setConcurrency] = useState('2');
  const [maxHours, setMaxHours] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [run, setRun] = useState<PortfolioRunResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = Boolean(run && ACTIVE.has(run.run.status));
  const selectedLabel = selection === 'all' ? `all ${repoCount}` : `top ${Math.min(Number(selection), repoCount)}`;

  const progress = useMemo(() => {
    if (!run || run.run.plannedCount <= 0) return 0;
    const finished = run.run.succeededCount + run.run.failedCount;
    return Math.min(100, Math.round((finished / run.run.plannedCount) * 100));
  }, [run]);

  const refresh = async (runId: string) => {
    try {
      let detail = await customFetch<PortfolioRunResponse>(`/api/repo-finisher/portfolio-runs/${runId}`, { responseType: 'json' });
      if (detail.items.some((item) => item.status === 'failed' && item.completionRunId)) {
        const heal = await postJson<PortfolioHealResponse>(`/api/repo-finisher/portfolio-runs/${runId}/self-heal`).catch(() => null);
        if (heal && heal.scheduled > 0) {
          detail = await customFetch<PortfolioRunResponse>(`/api/repo-finisher/portfolio-runs/${runId}`, { responseType: 'json' });
        }
      }
      setRun(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh Finish Portfolio run.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    customFetch<RawPortfolioRun[]>(`/api/repo-finisher/portfolio-runs?analysisId=${encodeURIComponent(analysisId)}`, { responseType: 'json' })
      .then((runs) => {
        if (cancelled || runs.length === 0) return;
        const recent = runs.find((candidate) => ACTIVE.has(candidate.status)) ?? runs[0];
        return refresh(recent.id);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  useEffect(() => {
    if (!run || !ACTIVE.has(run.run.status)) return;
    const timer = window.setInterval(() => void refresh(run.run.id), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.run.id, run?.run.status]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await postJson<PortfolioRunResponse>('/api/repo-finisher/portfolio-runs', {
        analysisId,
        selection: selection === 'all' ? 'all' : Number(selection),
        concurrency: Number(concurrency),
        ...(maxHours ? { maxEstimatedHours: Number(maxHours) } : {}),
        ...(maxCost ? { maxEstimatedCostUsd: Number(maxCost) } : {}),
        stopOnFailure,
        autonomyAcknowledged: true,
      });
      setRun(result);
      toast.success(`Finish Portfolio started for ${result.run.plannedCount} repositories.`, {
        description: 'Draft PRs only. Failed CI can receive up to two bounded code-only self-healing attempts; tests and validation rules stay protected.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start Finish Portfolio.';
      setError(message);
      toast.error(message.slice(0, 240));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      const result = await postJson<PortfolioRunResponse>(`/api/repo-finisher/portfolio-runs/${run.run.id}/cancel`);
      setRun(result);
      toast.success('Queued portfolio work cancelled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to cancel Finish Portfolio.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5 space-y-4 border-primary/25 bg-primary/[0.025] overflow-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary shrink-0" />
            <h3 className="font-semibold">Finish Portfolio</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            One action launches bounded autonomous completion across the highest-value repositories. Each repository gets its own generated plan, isolated branch, draft PR, CI verification, audit trail, outcome score, and bounded CI self-healing when needed.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is a higher-autonomy mode: clicking Finish Portfolio authorizes RepoFinisher to generate and execute plans inside the limits below. It never automatically merges a pull request, and repair agents cannot modify tests, workflows, security governance, or lockfiles.
          </p>
        </div>
        {isActive && (
          <Button variant="outline" size="sm" onClick={cancel} disabled={cancelling} className="gap-2 shrink-0">
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Stop queued work
          </Button>
        )}
      </div>

      {!isActive && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 text-xs text-muted-foreground">
            Repositories
            <select value={selection} onChange={(event) => setSelection(event.target.value as typeof selection)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="5">Top 5</option><option value="10">Top 10</option><option value="25">Top 25</option><option value="all">All {repoCount}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Parallel repos
            <select value={concurrency} onChange={(event) => setConcurrency(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Max estimated hours
            <input type="number" min="1" value={maxHours} onChange={(event) => setMaxHours(event.target.value)} placeholder="No cap" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Max estimated cost
            <input type="number" min="1" value={maxCost} onChange={(event) => setMaxCost(event.target.value)} placeholder="No cap" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <div className="flex items-end">
            <Button onClick={start} disabled={starting || repoCount === 0} className="w-full gap-2 h-10">
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {starting ? 'Starting…' : `Finish ${selectedLabel}`}
            </Button>
          </div>
        </div>
      )}

      {!isActive && (
        <label className="flex items-center gap-3 text-sm cursor-pointer w-fit">
          <Switch checked={stopOnFailure} onCheckedChange={setStopOnFailure} />
          Stop launching new repositories after the first failure
        </label>
      )}

      {error && <p className="text-sm text-red-500 break-words">{error}</p>}

      {run && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Status</div><div className="font-medium capitalize">{run.run.status.replace('_', ' ')}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Planned</div><div className="font-medium">{run.run.plannedCount}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Succeeded</div><div className="font-medium text-emerald-500">{run.run.succeededCount}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Verifying</div><div className="font-medium">{run.run.verifyingCount}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Failed</div><div className="font-medium text-red-500">{run.run.failedCount}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Est. hours</div><div className="font-medium">{Math.round(run.run.estimatedHoursSelected)}</div></div>
            <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">Est. cost</div><div className="font-medium">{money(run.run.estimatedCostSelected)}</div></div>
          </div>

          <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>

          <div className="max-h-72 overflow-auto rounded border divide-y">
            {run.items.map((item) => (
              <div key={item.id} className="p-3 flex items-start gap-2 text-sm">
                {itemIcon(item.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-x-2 gap-y-1 items-center">
                    <span className="font-mono break-all">#{item.rank} {item.repo}</span>
                    <span className="text-xs text-muted-foreground capitalize">{item.status}</span>
                    {item.ciStatus === 'repairing' && <span className="text-xs text-blue-500">self-healing CI</span>}
                  </div>
                  {item.error && <p className="mt-1 text-xs text-red-500 break-words">{item.error}</p>}
                </div>
                {item.prUrl && <a href={item.prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 shrink-0">PR #{item.prNumber} <ExternalLink className="h-3 w-3" /></a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
