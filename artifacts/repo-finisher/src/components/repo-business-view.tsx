import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';

interface GradeSummary {
  overall: number;
  letter: string;
  stage: string;
  stageLabel: string;
  evidenceCeiling: number;
  confidence: 'measured' | 'derived' | 'missing';
}

interface PortfolioRepoSummary {
  repo: string;
  rank: number | null;
  opportunityScore: number;
  grade: GradeSummary;
  demand: { index: number; band: string; bandLabel: string };
  valuation: {
    presentValue: { low: number; base: number; high: number };
    potentialValue: { low: number; base: number; high: number };
    valueGap: number;
    valuePerRemainingHour: number | null;
    remainingHours: number | null;
    confidence: 'low' | 'medium' | 'high';
  };
  finality: { score: number; isFinished: boolean; nextBestAction: string };
  signals: { completionPct: number; productionReadinessPct: number; language: string | null; stars: number | null; pushedAt: string | null };
}

interface PortfolioReport {
  methodologyVersion: string;
  analysisId: string;
  generatedAt: string;
  portfolio: {
    repos: number;
    averageGrade: number;
    averageDemand: number;
    averageFinality: number;
    finished: number;
    presentValueLow: number;
    presentValueHigh: number;
    potentialValueLow: number;
    potentialValueHigh: number;
    valueGap: number;
    stageCounts: Record<string, number>;
    demandBands: Record<string, number>;
  };
  repos: PortfolioRepoSummary[];
  message?: string;
  evidencePolicy?: string;
}

interface Dimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  confidence: 'measured' | 'derived' | 'missing';
  note: string;
}

interface RepoDetail {
  repo: string;
  evidenceSource: string;
  report: {
    grade: {
      overall: number;
      letter: string;
      stage: string;
      stageLabel: string;
      evidenceCeiling: number;
      confidence: string;
      dimensions: Dimension[];
      blockers: string[];
    };
    demand: {
      index: number;
      band: string;
      bandLabel: string;
      drivers: Array<{ label: string; score: number; weight: number; note: string }>;
      evidenceGaps: string[];
      confidence: string;
      summary: string;
    };
    valuation: {
      presentValue: { low: number; base: number; high: number };
      potentialValue: { low: number; base: number; high: number };
      valueGap: number;
      valuePerRemainingHour: number | null;
      remainingHours: number | null;
      replacementCost: number;
      confidence: string;
      confidenceScore: number;
      method: string;
      scenarios: Array<{ name: string; probability: number; low: number; high: number; assumptions: string[] }>;
      assumptions: string[];
      drivers: string[];
    };
    finality: {
      score: number;
      isFinished: boolean;
      nextBestAction: string;
      gaps: Array<{ key: string; label: string; score: number; target: number; delta: number; note: string }>;
      blockers: string[];
    };
  };
  suggestions: Array<{
    id: string;
    category: string;
    title: string;
    problem: string;
    action: string;
    why: string;
    impact: number;
    effort: number;
    priority: number;
    acceptance: string[];
    evidence: string[];
    builderPrompt: string;
  }>;
  builderPrompt: {
    prompt: string;
    target: string;
    promptVersion: string;
    quality: { score: number; checks: Array<{ id: string; label: string; passed: boolean; weight: number }> };
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

function money(value: number) {
  return usd.format(Number.isFinite(value) ? value : 0);
}

function range(low: number, high: number) {
  return `${compactUsd.format(low)}–${compactUsd.format(high)}`;
}

function gradeTone(letter: string) {
  if (letter.startsWith('A')) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (letter.startsWith('B')) return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  if (letter.startsWith('C')) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
}

function demandTone(band: string) {
  if (band === 'proven') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (band === 'emerging') return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  if (band === 'speculative') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
}

function Meter({ value, tone = 'primary' }: { value: number; tone?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${tone === 'primary' ? 'bg-primary' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function copy(text: string, label: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error('Could not copy to clipboard'));
}

export function RepoBusinessView({ analysisId }: { analysisId: string }) {
  const [portfolio, setPortfolio] = useState<PortfolioReport | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [promptTarget, setPromptTarget] = useState('provider-neutral');
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptSource, setPromptSource] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(null);

  const loadPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    setPortfolioError(null);
    try {
      const result = await customFetch<PortfolioReport>(`/api/repo-business/${analysisId}`, { responseType: 'json' });
      setPortfolio(result);
      if (!selectedRepo && result.repos.length > 0) setSelectedRepo(result.repos[0].repo);
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : 'Could not load repository business intelligence');
    } finally {
      setPortfolioLoading(false);
    }
  }, [analysisId, selectedRepo]);

  useEffect(() => {
    void loadPortfolio();
    // Load once per analysis. Selection changes are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setPromptText(null);
    setPromptSource(null);
    void customFetch<RepoDetail>(`/api/repo-business/${analysisId}/detail?repo=${encodeURIComponent(selectedRepo)}`, {
      responseType: 'json',
    })
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setPromptText(result.builderPrompt.prompt);
        setPromptSource('deterministic');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : 'Could not load repository detail');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, selectedRepo]);

  const requestPrompt = async (useAi: boolean) => {
    if (!selectedRepo) return;
    setPromptLoading(true);
    try {
      const result = await customFetch<{ prompt: string; source: string; model: string | null; note?: string }>(
        `/api/repo-business/${analysisId}/prompt`,
        {
          method: 'POST',
          responseType: 'json',
          body: JSON.stringify({ repo: selectedRepo, target: promptTarget, useAi }),
        },
      );
      setPromptText(result.prompt);
      setPromptSource(result.source);
      if (result.note) toast.info(result.note);
      else toast.success(useAi ? 'Model-tuned prompt ready' : 'Prompt rebuilt for this builder');
    } catch (error) {
      toast.error('Could not build the builder prompt', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setPromptLoading(false);
    }
  };

  const selectedSummary = useMemo(
    () => portfolio?.repos.find((repo) => repo.repo === selectedRepo) ?? null,
    [portfolio, selectedRepo],
  );

  if (portfolioLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (portfolioError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Business intelligence unavailable
          </CardTitle>
          <CardDescription className="break-words">{portfolioError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void loadPortfolio()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!portfolio || portfolio.repos.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No repositories to grade yet</CardTitle>
          <CardDescription>
            {portfolio?.message ?? 'Run a portfolio scan so business grading has measured repository evidence to work from.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Portfolio grade</CardDescription>
            <CardTitle className="text-3xl">{portfolio.portfolio.averageGrade}<span className="text-base text-muted-foreground">/100</span></CardTitle>
          </CardHeader>
          <CardContent>
            <Meter value={portfolio.portfolio.averageGrade} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Present value</CardDescription>
            <CardTitle className="text-2xl">{range(portfolio.portfolio.presentValueLow, portfolio.portfolio.presentValueHigh)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">What the portfolio is worth in its current state.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Value unlocked by finishing</CardDescription>
            <CardTitle className="text-2xl text-emerald-400">{compactUsd.format(portfolio.portfolio.valueGap)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Potential {range(portfolio.portfolio.potentialValueLow, portfolio.portfolio.potentialValueHigh)} — a labeled scenario, not a promise.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wide">Finished</CardDescription>
            <CardTitle className="text-3xl">
              {portfolio.portfolio.finished}<span className="text-base text-muted-foreground">/{portfolio.portfolio.repos}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Average finality {portfolio.portfolio.averageFinality}/100 · demand {portfolio.portfolio.averageDemand}/100</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span>Repositories</span>
              <Button variant="ghost" size="sm" onClick={() => void loadPortfolio()} className="gap-1 text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </CardTitle>
            <CardDescription className="text-xs">Ranked by opportunity, not alphabetically.</CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <div className="max-h-[34rem] overflow-y-auto space-y-1 pr-1">
              {portfolio.repos.map((repo) => {
                const active = repo.repo === selectedRepo;
                return (
                  <button
                    key={repo.repo}
                    type="button"
                    onClick={() => setSelectedRepo(repo.repo)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs truncate">{repo.repo}</div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={`font-mono text-[10px] ${gradeTone(repo.grade.letter)}`}>
                            {repo.grade.letter}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{repo.grade.stageLabel}</span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{repo.opportunityScore}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{range(repo.valuation.presentValue.low, repo.valuation.presentValue.high)}</span>
                      <span className={`inline-flex items-center gap-1 ${repo.demand.band === 'unproven' ? 'text-rose-400' : repo.demand.band === 'proven' ? 'text-emerald-400' : 'text-sky-400'}`}>
                        <TrendingUp className="h-3 w-3" /> {repo.demand.index}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {detailLoading && (
            <div className="space-y-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-64" />
            </div>
          )}

          {!detailLoading && detailError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Could not load this repository</CardTitle>
                <CardDescription className="break-words">{detailError}</CardDescription>
              </CardHeader>
            </Card>
          )}

          {!detailLoading && !detailError && detail && selectedSummary && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="font-mono text-lg break-all">{detail.repo}</CardTitle>
                      <CardDescription className="mt-1">
                        {detail.report.grade.stageLabel} · evidence {detail.evidenceSource.replace('-', ' ')} · {detail.report.grade.confidence} confidence
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`font-mono text-sm px-2.5 py-1 ${gradeTone(detail.report.grade.letter)}`}>
                        {detail.report.grade.letter} · {detail.report.grade.overall}
                      </Badge>
                      <Badge variant="outline" className={`${demandTone(detail.report.demand.band)}`}>
                        {detail.report.demand.bandLabel}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Present value</div>
                    <div className="text-lg font-semibold">{money(detail.report.valuation.presentValue.low)}–{money(detail.report.valuation.presentValue.high)}</div>
                    <div className="text-[11px] text-muted-foreground">Replacement cost {money(detail.report.valuation.replacementCost)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Potential value</div>
                    <div className="text-lg font-semibold text-emerald-400">{money(detail.report.valuation.potentialValue.low)}–{money(detail.report.valuation.potentialValue.high)}</div>
                    <div className="text-[11px] text-muted-foreground">{detail.report.valuation.confidence} confidence · {detail.report.valuation.confidenceScore}/100</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Finality</div>
                    <div className="text-lg font-semibold">{detail.report.finality.score}/100</div>
                    <div className="text-[11px] text-muted-foreground">{detail.report.finality.nextBestAction}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" /> Where this repository is at
                  </CardTitle>
                  <CardDescription>
                    Weighted dimensions. Unknown evidence is marked missing and caps the grade at {detail.report.grade.evidenceCeiling}/100.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {detail.report.grade.dimensions.map((dimension) => (
                    <div key={dimension.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{dimension.label}</span>
                        <span className="font-mono text-muted-foreground">
                          {dimension.confidence === 'missing' ? 'missing' : `${Math.round(dimension.score)}`}
                        </span>
                      </div>
                      <Meter value={dimension.confidence === 'missing' ? 0 : dimension.score} tone={dimension.score >= 75 ? 'emerald' : dimension.score >= 45 ? 'primary' : 'amber'} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-sky-400" /> Demand
                    </CardTitle>
                    <CardDescription>{detail.report.demand.summary}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.report.demand.drivers.map((driver) => (
                      <div key={driver.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>{driver.label}</span>
                          <span className="font-mono text-muted-foreground">{Math.round(driver.score)}</span>
                        </div>
                        <Meter value={driver.score} />
                        <p className="text-[11px] text-muted-foreground">{driver.note}</p>
                      </div>
                    ))}
                    {detail.report.demand.evidenceGaps.length > 0 && (
                      <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5">
                        <div className="text-[11px] font-medium text-amber-400 mb-1">Evidence gaps</div>
                        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                          {detail.report.demand.evidenceGaps.map((gap) => (
                            <li key={gap}>· {gap}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ArrowUpRight className="h-4 w-4 text-emerald-400" /> Fair market value
                    </CardTitle>
                    <CardDescription>{detail.report.valuation.method}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.report.valuation.scenarios.map((scenario) => (
                      <div key={scenario.name} className="rounded-md border border-border p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize font-medium">{scenario.name}</span>
                          <span className="font-mono text-muted-foreground">{Math.round(scenario.probability * 100)}%</span>
                        </div>
                        <div className="mt-1 text-sm font-semibold">{money(scenario.low)}–{money(scenario.high)}</div>
                        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                          {scenario.assumptions.map((assumption) => (
                            <li key={assumption}>· {assumption}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {detail.report.valuation.valuePerRemainingHour !== null && (
                      <p className="text-[11px] text-muted-foreground">
                        Value unlocked per remaining engineering hour: <span className="text-foreground font-mono">{money(detail.report.valuation.valuePerRemainingHour)}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" /> Improvement plan ({detail.suggestions.length})
                  </CardTitle>
                  <CardDescription>Each item carries its own builder prompt. Expand to read or copy it.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detail.suggestions.map((suggestion) => {
                    const expanded = expandedSuggestion === suggestion.id;
                    return (
                      <div key={suggestion.id} className="rounded-md border border-border">
                        <button
                          type="button"
                          onClick={() => setExpandedSuggestion(expanded ? null : suggestion.id)}
                          className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/30"
                        >
                          {expanded ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{suggestion.title}</span>
                              <Badge variant="secondary" className="text-[10px] uppercase">{suggestion.category}</Badge>
                              <span className="text-[11px] text-muted-foreground">impact {suggestion.impact}/5 · effort {suggestion.effort}/5</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{suggestion.problem}</p>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">{suggestion.priority}</span>
                        </button>
                        {expanded && (
                          <div className="space-y-3 border-t border-border p-3 text-xs">
                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Do</div>
                              <p>{suggestion.action}</p>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Why it matters</div>
                              <p className="text-muted-foreground">{suggestion.why}</p>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Acceptance</div>
                              <ul className="space-y-0.5">
                                {suggestion.acceptance.map((item) => (
                                  <li key={item} className="flex gap-1.5">
                                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <Button variant="outline" size="sm" className="gap-2" onClick={() => copy(suggestion.builderPrompt, 'Builder prompt')}>
                              <ClipboardCopy className="h-3.5 w-3.5" /> Copy builder prompt
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" /> Finality prompt for a builder model
                      </CardTitle>
                      <CardDescription>
                        Prompt quality {detail.builderPrompt.quality.score}/100 · {promptSource === 'ai' ? 'model-tuned' : 'reviewed deterministic'}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={promptTarget}
                        onChange={(event) => setPromptTarget(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                        aria-label="Builder target"
                      >
                        <option value="provider-neutral">Any builder</option>
                        <option value="codex">Codex</option>
                        <option value="claude-code">Claude Code</option>
                        <option value="gemini-cli">Gemini CLI</option>
                      </select>
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={promptLoading} onClick={() => void requestPrompt(false)}>
                        {promptLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Rebuild
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={promptLoading} onClick={() => void requestPrompt(true)}>
                        {promptLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        AI-tune
                      </Button>
                      <Button size="sm" className="gap-1.5" onClick={() => copy(promptText ?? detail.builderPrompt.prompt, 'Finality prompt')}>
                        <ClipboardCopy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {promptText ?? detail.builderPrompt.prompt}
                  </pre>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.builderPrompt.quality.checks.map((check) => (
                      <span
                        key={check.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                          check.passed ? 'border-emerald-500/30 text-emerald-400' : 'border-rose-500/30 text-rose-400'
                        }`}
                        title={check.label}
                      >
                        {check.passed ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {check.label}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {portfolio.evidencePolicy && (
        <p className="text-[11px] text-muted-foreground">{portfolio.evidencePolicy}</p>
      )}
    </div>
  );
}

export default RepoBusinessView;
