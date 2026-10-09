import { useState } from 'react';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 20;

// Mount only one page of repository controls: each restores run, prompt, and
// completion-session history, so mounting a full portfolio causes a request burst.
export function useRepositoryPagination<T>(rows: T[], scope: string) {
  const [selection, setSelection] = useState({ scope, page: 0 });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = selection.scope === scope ? Math.min(selection.page, pageCount - 1) : 0;
  if (selection.scope !== scope || selection.page !== page) {
    setSelection({ scope, page });
  }
  const start = page * PAGE_SIZE;

  return {
    rows: rows.slice(start, start + PAGE_SIZE),
    page,
    pageCount,
    total: rows.length,
    setPage: (nextPage: number) => setSelection({ scope, page: nextPage }),
  };
}

export function RepositoryPagination({ page, pageCount, total, setPage }: {
  page: number;
  pageCount: number;
  total: number;
  setPage: (page: number) => void;
}) {
  return (
    <nav aria-label="Repository pages" className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} repositories
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <Button type="button" variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </nav>
  );
}
