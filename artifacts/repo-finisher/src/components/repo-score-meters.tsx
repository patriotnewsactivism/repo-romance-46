import { displayScore } from '@/lib/portfolio-types';
import { cn } from '@/lib/utils';

export interface RepoScoreMetersProps {
  completeness: number;
  uniqueness: number;
  demand: number;
  competition: number;
  compact?: boolean;
  className?: string;
}

function meterTone(score: number) {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 55) return 'bg-amber-500';
  return 'bg-slate-400';
}

function Meter({ label, value }: { label: string; value: number }) {
  const score = displayScore(value);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">{score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', meterTone(score))}
          style={{ width: `${score}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export function RepoScoreMeters({
  completeness,
  uniqueness,
  demand,
  competition,
  compact = false,
  className,
}: RepoScoreMetersProps) {
  return (
    <div
      className={cn(
        'grid gap-3',
        compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 md:grid-cols-4',
        className,
      )}
      aria-label="Repository scores out of 100"
    >
      <Meter label="Completeness" value={completeness} />
      <Meter label="Uniqueness" value={uniqueness} />
      <Meter label="Demand" value={demand} />
      <Meter label="Competition" value={competition} />
    </div>
  );
}
