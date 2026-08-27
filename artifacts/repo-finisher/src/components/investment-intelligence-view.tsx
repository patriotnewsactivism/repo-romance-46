import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';

type EvidenceClass = 'verified' | 'derived' | 'model_estimate' | 'insufficient';
type RunStatus = 'awaiting_approval' | 'approved' | 'executing' | 'verifying' | 'succeeded' | 'failed' | 'cancelled' | 'stale';

interface EvidenceItem {
  class: EvidenceClass;
  label: string;
  detail: string;
  source?: string;
}

interface RankingItem {
  repo: string;
  rank: number;
  finishFirstScore: number;
  completionPct: number;
  productionReadinessPct: number;
  presentValueUsd: { low: number; high: number };
  potentialValueUsd: { low: number; high: number };
  marketNeed: number;
  demand: number;
  competitivePressure: number;
  commercializationProbability: number;
  remainingWork: { hours: number; costUsd: { low: number; high: number } };
  evidenceConfidence: number;
  evidence: EvidenceItem[];
  rationale: string[];
  details?: {
    kind: string;
    recommendedNextSteps: string[];
    market?: { market_summary?: string };
  };
}

interface IntelligenceResult {
  methodologyVersion: string;
  generatedAt: string;
  analysisId: string;
  ranking: RankingItem[];
  errors: string[];
  portfolio: {
    reposScored: number;
    presentValueLow: number;
    presentValueHigh: number;
    potentialValueLow: number;
    potentialValueHigh: number;
    weightedCommercializationProbability: number;
  };
  recommendation: string;
  evidencePolicy: string;
}

interface AgentTrace {
  role: string;
  summary: string;
  priorities: string[];
  risks: string[];
  validation: string[];
}

interface AgenticPreview {
  runId: string;
  status: 'awaiting_approval';
  repo: string;
  planHash: string;
  baseSha: string;
  summary: string;
  changes: Array<{ path: string; status: string; content: string; description: string }>;
  agents: AgentTrace[];
  learning: { hasHistory: boolean; guidance: string[]; promptVersion: string };
}

interface RunDetail {
  run: {
    id: string;
    status: RunStatus;
    planHash: string;
    prNumber: number | null;
    prUrl: string | null;
    error: string | null;
    ciStatus: string | null;
  };
  verification: { state: 'pending' | 'passed' | 'failed'; message: string } | null;
}

function money(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

function scoreClass(score: number) {
  if (score >= 75) return 'text-emerald-500 border-emerald-500/30';
  if (score >= 55) return 'text-amber-500 border-amber-500/30';
  return 'text-muted-foreground border-border';
}

function evidenceClass(item: EvidenceItem) {
  switch (item.class) {
    case 'verified': return 'border-emerald-500/30 text-emerald-500';
    case 'derived': return 'border-blue-500/30 text-blue-500';
    case 'model_estimate': return 'border-violet-500/30 text-violet-500';
    default: return 'border-amber-500/30 text-amber-500';
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return customFetch<T>(path, {
    method: 'POST',
    responseType: 'json',
    body: JSON.stringify(body ?? {}),
  });
}

function AgenticFinishAction({ analysisId, item }: { analysisId: string; item: RankingItem }) {
  const [preview, setPreview] = useState<AgenticPreview | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const runId = detail?.run.id ?? preview?.runId ?? null;
  const status = detail?.run.status ?? preview?.status ?? null;

  const refresh = async () => {
    if (!runId) return;
    const data = await customFetch<RunDetail>(`/api/repo-finisher/runs/${runId}`, { responseType: 'json' });
    setDetail(data);
    return data;
  };

  useEffect(() => {
    if (!runId || (status !== 'executing' && status !== 'verifying')) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, [runId, status]);

  const plan = async () => {
    setBusy('plan');
    try {
      const data = await postJson<AgenticPreview>('/api/repo-finisher/agentic-preview', {
        repo: item.repo,
        analysisId,
        nextSteps: item.details?.recommendedNextSteps ?? [],
      });
      setPreview(data);
      toast.success('Agent council and coding agent prepared an exact completion plan.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : 'Autonomous planning failed.');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!preview) return;
    setBusy('approve');
    try {
      await postJson(`/api/repo-finisher/runs/${preview.runId}/approve`, { planHash: preview.planHash });
      await refresh();
      toast.success('Exact agent-generated plan approved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 240) : 'Approval failed.');
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    if (!runId) return;
    setBusy('execute');
    try {
      await postJson(`/api/repo-finisher/runs/${runId}/execute`);
      await refresh();
      toast.success('Autonomous coding plan executed into a draft PR; CI verification is running.');
    } catch (error) {
      await refresh().catch(() => undefined);
      toast.error(error instanceof Error ? error.message.slice(0, 240) : 'Execution failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!preview && !detail) {
    return (
      <Button size="sm" onClick={plan} disabled={busy !== null} className="gap-2">
        {busy === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
        Prepare autonomous agent plan
      </Button>
    );
  }

  return (
    <Card className="p-4 space-y-4 border-primary/30">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Autonomous coding council</span>
        <Badge variant="outline" className="ml-auto">{status}</Badge>
      </div>

      {preview && (
        <>
          <p className="text-sm text-muted-foreground">{preview.summary}</p>
          <div className="grid gap-2 md:grid-cols-3">
            {preview.agents.map((agent) => (
              <div key={agent.role} className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-mono uppercase text-primary">{agent.role}</div>
                <p className="text-xs text-muted-foreground">{agent.summary}</p>
              </div>
            ))}
          </div>

          {preview.learning.guidance.length > 0 && (
            <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="text-xs font-mono text-violet-500 mb-2">ADAPTIVE MEMORY USED</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {preview.learning.guidance.map((lesson, index) => <li key={index}>• {lesson}</li>)}
              </ul>
            </div>
          )}

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
              <FileCode2 className="h-4 w-4" /> Inspect exact plan ({preview.changes.length} files)
            </summary>
            <div className="mt-3 space-y-2">
              {preview.changes.map((change) => (
                <details key={change.path} className="rounded border p-2">
                  <summary className="cursor-pointer text-xs font-mono">{change.status} {change.path}</summary>
                  <p className="mt-1 text-xs text-muted-foreground">{change.description}</p>
                  {change.status !== 'deleted' && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] whitespace-pre-wrap">{change.content}</pre>
                  )}
                </details>
              ))}
            </div>
          </details>
        </>
      )}

      {detail?.run.error && (
        <div className="flex items-start gap-2 text-sm text-red-500"><AlertTriangle className="h-4 w-4 mt-0.5" />{detail.run.error}</div>
      )}
      {detail?.verification && <p className="text-xs text-muted-foreground">CI: {detail.verification.message}</p>}

      {status === 'awaiting_approval' && preview && (
        <Button size="sm" onClick={approve} disabled={busy !== null} className="gap-2">
          {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Approve exact plan
        </Button>
      )}
      {status === 'approved' && (
        <Button size="sm" onClick={execute} disabled={busy !== null} className="gap-2">
          {busy === 'execute' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Execute into draft PR
        </Button>
      )}
      {(status === 'executing' || status === 'verifying') && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Autonomous work is being verified…</div>
      )}
      {status === 'succeeded' && detail?.run.prUrl && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Verified successfully
          <a href={detail.run.prUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-500 hover:underline flex items-center gap-1">
            PR #{detail.run.prNumber} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </Card>
  );
}

export function InvestmentIntelligenceView({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<IntelligenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await customFetch<IntelligenceResult | null>(`/api/investment-intelligence/${analysisId}`, { responseType: 'json' });
      setData(existing);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load investment intelligence.';
      if (!/schema is not applied/i.test(message)) setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [analysisId]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await postJson<IntelligenceResult>(`/api/investment-intelligence/${analysisId}`);
      setData(result);
      toast.success(`Ranked ${result.ranking.length} repositories by finish-first opportunity.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Investment intelligence failed.';
      setError(message);
      toast.error(message.slice(0, 240));
    } finally {
      setRunning(false);
    }
  };

  if (loading && !data) {
    return <Card className="p-6 flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Loading investment intelligence…</Card>;
  }

  if (!data) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" /><h3 className="font-semibold">Repo Investment Intelligence</h3></div>
        <p className="text-sm text-muted-foreground">
          Score completion, present value, potential value, market need, demand, competition, remaining cost/time, and commercialization probability — then rank what should be finished first.
        </p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button onClick={run} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          {running ? 'Building investment intelligence…' : 'Run Investment Intelligence'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4 border-primary/20">
        <div className="flex flex-wrap items-start gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Target className="h-4 w-4 text-primary" />Finish-first recommendation</div>
            <h3 className="text-xl font-semibold">{data.recommendation}</h3>
            <p className="text-xs text-muted-foreground">{data.evidencePolicy}</p>
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Present value</div><div className="font-semibold">{money(data.portfolio.presentValueLow)}–{money(data.portfolio.presentValueHigh)}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Potential value</div><div className="font-semibold">{money(data.portfolio.potentialValueLow)}–{money(data.portfolio.potentialValueHigh)}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Commercialization</div><div className="font-semibold">{data.portfolio.weightedCommercializationProbability}%</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Repos scored</div><div className="font-semibold">{data.portfolio.reposScored}</div></div>
        </div>
      </Card>

      {data.errors.length > 0 && (
        <Card className="p-4 border-amber-500/30"><div className="flex gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-500" />{data.errors.length} repo(s) could not be scored. Successful scores are still shown.</div></Card>
      )}

      {data.ranking.map((item) => (
        <Card key={item.repo} className="p-5 space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">#{item.rank}</Badge>
                <span className="font-mono font-semibold break-all">{item.repo}</span>
                {item.details?.kind && <Badge variant="secondary">{item.details.kind}</Badge>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{item.rationale.join(' • ')}</p>
            </div>
            <div className={`rounded-lg border px-4 py-2 text-center ${scoreClass(item.finishFirstScore)}`}>
              <div className="text-2xl font-bold">{item.finishFirstScore}</div><div className="text-[10px] uppercase font-mono">finish first</div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Completion</div><div className="font-semibold">{item.completionPct}%</div><div className="text-[11px] text-muted-foreground">Readiness {item.productionReadinessPct}%</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Present → potential</div><div className="font-semibold">{money(item.presentValueUsd.low)}–{money(item.presentValueUsd.high)}</div><div className="text-[11px] text-emerald-500">→ {money(item.potentialValueUsd.low)}–{money(item.potentialValueUsd.high)}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Remaining work</div><div className="font-semibold">~{Math.round(item.remainingWork.hours)}h</div><div className="text-[11px] text-muted-foreground">{money(item.remainingWork.costUsd.low)}–{money(item.remainingWork.costUsd.high)}</div></div>
            <div className="rounded border p-3"><div className="text-xs text-muted-foreground">Commercialization probability</div><div className="font-semibold">{item.commercializationProbability}%</div><div className="text-[11px] text-muted-foreground">Evidence {item.evidenceConfidence}/100</div></div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded border p-3 text-sm"><span className="text-muted-foreground">Market need</span><span className="float-right font-semibold">{item.marketNeed}/100</span></div>
            <div className="rounded border p-3 text-sm"><span className="text-muted-foreground">Demand</span><span className="float-right font-semibold">{item.demand}/100</span></div>
            <div className="rounded border p-3 text-sm"><span className="text-muted-foreground">Competitive pressure</span><span className="float-right font-semibold">{item.competitivePressure}/100</span></div>
          </div>

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" /> Evidence ledger</summary>
            <div className="mt-3 space-y-2">
              {item.evidence.map((evidence, index) => (
                <div key={`${evidence.label}-${index}`} className="rounded-md border p-3">
                  <div className="flex items-center gap-2"><Badge variant="outline" className={evidenceClass(evidence)}>{evidence.class.replace('_', ' ')}</Badge><span className="text-sm font-medium">{evidence.label}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground">{evidence.detail}</p>
                </div>
              ))}
            </div>
          </details>

          <AgenticFinishAction analysisId={analysisId} item={item} />
        </Card>
      ))}
    </div>
  );
}
