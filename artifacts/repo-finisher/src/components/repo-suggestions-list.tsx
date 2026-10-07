import { Badge } from '@/components/ui/badge';
import type { RepoSuggestion } from '@/lib/portfolio-types';
import { Lightbulb } from 'lucide-react';

interface RepoSuggestionsListProps {
  suggestions: RepoSuggestion[];
  defaultOpen?: boolean;
  previewCount?: number;
}

export function RepoSuggestionsList({
  suggestions,
  defaultOpen = false,
  previewCount = 2,
}: RepoSuggestionsListProps) {
  if (suggestions.length === 0) return null;

  const preview = suggestions.slice(0, previewCount);

  return (
    <details className="rounded-md border p-3" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
        <span>
          {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} to improve or finish
        </span>
      </summary>
      {!defaultOpen && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {preview.map((suggestion) => (
            <li key={`preview-${suggestion.id}`} className="truncate">
              • {suggestion.title}
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 space-y-2">
        {suggestions.map((suggestion, index) => (
          <li key={suggestion.id} className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">
                #{index + 1}
              </Badge>
              <span className="font-medium">{suggestion.title}</span>
              <Badge variant="secondary">effort {suggestion.effort}/5</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.action}</p>
            <p className="text-[11px] text-muted-foreground">{suggestion.why}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
