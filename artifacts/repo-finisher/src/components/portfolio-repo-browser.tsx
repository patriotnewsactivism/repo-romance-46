import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FinishRepoAction } from '@/components/finish-repo-action';
import { FinishUntilTargetControl } from '@/components/finish-until-target-control';
import { PortfolioFinishControl } from '@/components/portfolio-finish-control';
import { RepoScoreMeters } from '@/components/repo-score-meters';
import { RepoSuggestionsList } from '@/components/repo-suggestions-list';
import { RepositoryPagination, useRepositoryPagination } from '@/components/repository-pagination';
import {
  displayScore,
  resolveRepoSuggestions,
  uniquenessScore,
  type PortfolioIntelligenceSnapshot,
  type PortfolioRankingItem,
} from '@/lib/portfolio-types';
import { ArrowUpRight, Loader2, Search } from 'lucide-react';

type SortKey =
  | 'finish-first'
  | 'completeness'
  | 'uniqueness'
  | 'demand'
  | 'competition'
  | 'closest-to-finish';

interface PortfolioRepoBrowserProps {
  analysisId: string;
  snapshot: PortfolioIntelligenceSnapshot | null;
  loading?: boolean;
  onRefreshScores?: () => void;
  refreshing?: boolean;
}

function languageHint(item: PortfolioRankingItem): string {
  if (item.details?.language) return item.details.language;
  const githubLanguage = item.details?.github && 'language' in item.details.github
    ? (item.details.github as { language?: string | null }).language
    : null;
  if (githubLanguage) return githubLanguage;
  const kind = item.details?.kind;
  return kind || 'repo';
}

export function PortfolioRepoBrowser({
  analysisId,
  snapshot,
  loading = false,
  onRefreshScores,
  refreshing = false,
}: PortfolioRepoBrowserProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('finish-first');
  const [minCompleteness, setMinCompleteness] = useState(0);
  const [language, setLanguage] = useState('all');
  const [closestOnly, setClosestOnly] = useState(false);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const item of snapshot?.ranking ?? []) {
      const hint = languageHint(item);
      if (hint && hint !== 'repo') set.add(hint);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [snapshot]);

  const filtered = useMemo(() => {
    const ranking = snapshot?.ranking ?? [];
    const q = query.trim().toLowerCase();
    let rows = ranking.filter((item) => {
      if (q && !item.repo.toLowerCase().includes(q) && !(item.details?.title || '').toLowerCase().includes(q)) {
        return false;
      }
      if (language !== 'all' && languageHint(item).toLowerCase() !== language.toLowerCase()) {
        return false;
      }
      if (displayScore(item.completionPct) < minCompleteness) return false;
      if (closestOnly && displayScore(item.completionPct) < 70) return false;
      return true;
    });

    const scoreFor = (item: PortfolioRankingItem, key: SortKey): number => {
      switch (key) {
        case 'completeness':
          return displayScore(item.completionPct);
        case 'uniqueness':
          return uniquenessScore(item);
        case 'demand':
          return displayScore(item.demand);
        case 'competition':
          return displayScore(item.competitivePressure);
        case 'closest-to-finish':
          return displayScore(item.completionPct) * 0.7 + displayScore(item.productionReadinessPct) * 0.3;
        case 'finish-first':
        default:
          return item.finishFirstScore;
      }
    };

    rows = [...rows].sort((a, b) => {
      const diff = scoreFor(b, sort) - scoreFor(a, sort);
      if (diff !== 0) return diff;
      return a.repo.localeCompare(b.repo);
    });
    return rows;
  }, [snapshot, query, sort, minCompleteness, closestOnly, language]);

  const pagination = useRepositoryPagination(filtered, JSON.stringify([
    analysisId, snapshot?.generatedAt, query, sort, minCompleteness, closestOnly, language,
  ]));

  if (loading && !snapshot) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading scored portfolio…
        </CardContent>
      </Card>
    );
  }

  if (!snapshot || snapshot.ranking.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <p className="text-muted-foreground">
            No scored repositories yet. Run a portfolio scan, then refresh scores to grade each repo.
          </p>
          {onRefreshScores && (
            <Button onClick={onRefreshScores} disabled={refreshing} className="gap-2">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {refreshing ? 'Scoring…' : 'Score portfolio'}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {snapshot.recommendation && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Finish-first recommendation</p>
            <p className="text-sm font-medium leading-relaxed">{snapshot.recommendation}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{snapshot.portfolio.reposScored} repos scored</span>
              <span>·</span>
              <span>Updated {new Date(snapshot.generatedAt).toLocaleString()}</span>
              {onRefreshScores && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7"
                  onClick={onRefreshScores}
                  disabled={refreshing}
                >
                  {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh scores'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <PortfolioFinishControl analysisId={analysisId} repoCount={snapshot.ranking.length} />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-end">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a repository…"
              className="pl-9"
              data-testid="input-portfolio-search"
            />
          </div>
          <label className="space-y-1 text-xs text-muted-foreground">
            Sort by
            <select
              className="flex h-9 w-full min-w-[10rem] rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              data-testid="select-portfolio-sort"
            >
              <option value="finish-first">Finish-first</option>
              <option value="closest-to-finish">Closest to finish</option>
              <option value="completeness">Completeness</option>
              <option value="uniqueness">Uniqueness</option>
              <option value="demand">Demand</option>
              <option value="competition">Competition</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Language
            <select
              className="flex h-9 w-full min-w-[8rem] rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              data-testid="select-portfolio-language"
            >
              <option value="all">All languages</option>
              {languages.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Min completeness
            <select
              className="flex h-9 w-full min-w-[8rem] rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={minCompleteness}
              onChange={(event) => setMinCompleteness(Number(event.target.value))}
            >
              <option value={0}>Any</option>
              <option value={40}>40+</option>
              <option value={60}>60+</option>
              <option value={75}>75+</option>
              <option value={90}>90+</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="checkbox"
              checked={closestOnly}
              onChange={(event) => setClosestOnly(event.target.checked)}
              className="accent-primary"
            />
            Closest to finish (70%+)
          </label>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {snapshot.ranking.length} scored repositories match the current filters
      </p>
      <RepositoryPagination {...pagination} />

      <div className="space-y-3">
        {pagination.rows.map((item) => {
          const suggestions = resolveRepoSuggestions(item);
          const nextSteps = suggestions.map((suggestion) => suggestion.action);
          return (
            <Card key={`${analysisId}:${item.repo}`} className="overflow-hidden" data-testid={`card-repo-${item.repo}`}>
              <CardContent className="space-y-4 pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">#{item.rank}</Badge>
                      <span className="font-mono font-semibold break-all">{item.repo}</span>
                      <Badge variant="secondary">{languageHint(item)}</Badge>
                      <Badge variant="outline" className="font-mono">
                        finish-first {Math.round(item.finishFirstScore)}
                      </Badge>
                    </div>
                    {item.details?.pitch && (
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.details.pitch}</p>
                    )}
                    {item.rationale?.[0] && (
                      <p className="text-xs text-muted-foreground">{item.rationale.slice(0, 2).join(' · ')}</p>
                    )}
                  </div>
                  <Link href={`/analysis/${analysisId}`}>
                    <Button variant="ghost" size="sm" className="gap-1 shrink-0">
                      Open analysis
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>

                <RepoScoreMeters
                  completeness={item.completionPct}
                  uniqueness={uniquenessScore(item)}
                  demand={item.demand}
                  competition={item.competitivePressure}
                  compact
                />

                <RepoSuggestionsList suggestions={suggestions} defaultOpen={item.rank <= 2} />

                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Use <span className="font-medium text-foreground">Finish until target</span> to iterate toward
                    95% completeness / 90% readiness, or run a single finish pass for one draft PR.
                  </p>
                  <FinishUntilTargetControl
                    repo={item.repo}
                    nextSteps={nextSteps}
                    analysisId={analysisId}
                    itemRank={
                      typeof item.details?.analysisItemRank === 'number'
                        ? item.details.analysisItemRank
                        : undefined
                    }
                  />
                </div>
                <FinishRepoAction
                  repo={item.repo}
                  nextSteps={nextSteps}
                  analysisId={analysisId}
                  itemRank={
                    typeof item.details?.analysisItemRank === 'number'
                      ? item.details.analysisItemRank
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
      {pagination.pageCount > 1 && <RepositoryPagination {...pagination} />}
    </div>
  );
}
