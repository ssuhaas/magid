'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { labels, needsReview, reviewStats } from '@/lib/ui/review.mjs';
import { hasProjectedIdentity, stockCodeReady } from '@/lib/canonical/identity.mjs';
import type { Book, Item } from '@/lib/review-types';

type Props = {
  stats: ReturnType<typeof reviewStats>;
  reviewed: number;
  query: string;
  reviewOnly: boolean;
  visible: Item[];
  selected: string;
  columns: Record<string, string>;
  book: Book;
  processingComplete: boolean;
  filteredCount: number;
  listPage: number;
  onQueryChange: (query: string) => void;
  onReviewOnlyChange: (reviewOnly: boolean) => void;
  onSelect: (id: string) => void;
  onPageChange: (page: number) => void;
  onBatch: (action: string) => void;
  onIdentifyColumns: () => void;
};

export function ReviewItemList({
  stats,
  reviewed,
  query,
  reviewOnly,
  visible,
  selected,
  columns,
  book,
  processingComplete,
  filteredCount,
  listPage,
  onQueryChange,
  onReviewOnlyChange,
  onSelect,
  onPageChange,
  onBatch,
  onIdentifyColumns,
}: Props) {
  return (
    <section className="records">
      <div className="panel-head">
        <h2>Item exceptions</h2>
        <Badge variant="outline">{stats.pendingItems} pending</Badge>
      </div>
      <p className="item-counts" aria-live="polite">
        {stats.total} total · {reviewed} complete · {stats.excluded} excluded
      </p>
      <div className="search">
        <Search size={18} />
        <Input
          aria-label="Search items"
          placeholder="Search description or code"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
          }}
        />
      </div>
      <label className="filter">
        <Checkbox
          checked={reviewOnly}
          onCheckedChange={(v) => {
            onReviewOnlyChange(v === true);
          }}
        />
        Only show exceptions
      </label>
      <div className="item-list">
        {visible.map((r) => {
          const pending = needsReview(r, columns, book);
          const pendingFieldCount = pending
            ? reviewStats([r], columns, null, book).pendingFields
            : 0;
          return (
            <button
              key={r.id}
              className={'record ' + (r.id === selected ? 'selected' : '')}
              aria-pressed={r.id === selected}
              onClick={() => onSelect(r.id)}
            >
              <strong>
                {r.values.E.value || r.extras['Source Product ID']?.value || 'Item to identify'}
              </strong>
              <small>
                {r.sheet} · {r.anchors.join(', ')}
              </small>
              <Badge variant="outline" className={pending ? 'review' : 'ready'}>
                {r.boundary === 'exclude'
                  ? 'Excluded'
                  : pending
                    ? pendingFieldCount
                      ? `${pendingFieldCount} fields pending${r.boundary === 'pending' ? ' · confirm item' : ''}`
                      : !hasProjectedIdentity(r.values)
                        ? 'Needs source identity'
                        : 'Confirm item inclusion'
                    : stockCodeReady(r, columns, book) && !hasProjectedIdentity(r.values)
                      ? 'Item checks complete — stock code only'
                      : 'Item checks complete'}
              </Badge>
            </button>
          );
        })}
        {!visible.length && (
          <p className="empty">
            {reviewOnly && !stats.pendingItems
              ? processingComplete
                ? 'No item exceptions remain. Inspect the prepared spreadsheet, or turn off the filter to browse all items.'
                : 'Source checks are still pending. Any exceptions will appear here after processing.'
              : 'No items match this view.'}
          </p>
        )}
      </div>
      <div className="pagination">
        <small>
          {filteredCount
            ? `${listPage * 10 + 1}–${Math.min(listPage * 10 + 10, filteredCount)}`
            : '0'}{' '}
          of {filteredCount} {reviewOnly ? 'pending items in this view' : 'items in this view'}
        </small>
        <Button variant="ghost" disabled={!listPage} onClick={() => onPageChange(listPage - 1)}>
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={(listPage + 1) * 10 >= filteredCount}
          onClick={() => onPageChange(listPage + 1)}
        >
          Next
        </Button>
      </div>
      <details className="batch-controls">
        <summary>Review several items together</summary>
        <p>Preview the affected items before confirming any changes.</p>
        <Button variant="outline" onClick={() => onBatch('boundaries')}>
          Confirm which rows are items
        </Button>
        <Button variant="outline" onClick={() => onBatch('direct')}>
          Review copied values together
        </Button>
        <label>
          Leave a field blank across these items
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onBatch('blank:' + e.target.value);
            }}
          >
            <option value="">Choose a field…</option>
            {Object.entries(labels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </details>
      <button className="text-button mapping-link" onClick={onIdentifyColumns}>
        Items missing or columns incorrect?
      </button>
    </section>
  );
}
