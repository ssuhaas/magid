'use client';

import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { reviewStats } from '@/lib/ui/review.mjs';

type Props = {
  name: string;
  sheetCount: number;
  stats: ReturnType<typeof reviewStats>;
  processingComplete: boolean;
  aiBusy: boolean;
  evaluationRequired: boolean;
  evaluationComplete: boolean;
  remainingCount: number;
  itemCount: number;
  fieldsPending: number;
  boundariesPending: number;
  reviewed: number;
  excluded: number;
  pendingColumns: number;
  coverage: boolean;
  unresolvedCells: number;
  blockerCount: number;
  nextLabel: string;
  onReplace: () => void;
  onNext: () => void;
};

export function ReviewOverview({
  name,
  sheetCount,
  stats,
  processingComplete,
  aiBusy,
  evaluationRequired,
  evaluationComplete,
  remainingCount,
  itemCount,
  fieldsPending,
  boundariesPending,
  reviewed,
  excluded,
  pendingColumns,
  coverage,
  unresolvedCells,
  blockerCount,
  nextLabel,
  onReplace,
  onNext,
}: Props) {
  return (
    <>
      <div className="file-bar">
        <FileSpreadsheet size={24} />
        <div>
          <strong>{name}</strong>
          <small>
            {sheetCount} {sheetCount === 1 ? 'sheet' : 'sheets'} · {stats.total} total items found ·{' '}
            {stats.pendingItems} current exceptions
            {!processingComplete ? ' · source checks pending' : ''}
          </small>
        </div>
        <Button variant="ghost" onClick={onReplace}>
          Replace file
        </Button>
      </div>
      <section className="next-action">
        <div aria-live="polite">
          <h2>
            {aiBusy
              ? 'Checking extraction against the proposal…'
              : evaluationRequired && !evaluationComplete
                ? 'AI source checks are not complete'
                : remainingCount
                  ? `${remainingCount} ${remainingCount === 1 ? 'item needs' : 'items need'} your review`
                  : itemCount
                    ? 'No item exceptions'
                    : 'Help us identify the items'}
          </h2>
          <p>
            {stats.handledFields} of {stats.totalFields} fields handled · {fieldsPending} current
            field exceptions · {boundariesPending} item boundaries to confirm
          </p>
          <progress
            aria-label="Field review progress"
            max={Math.max(stats.totalFields, 1)}
            value={stats.handledFields}
          />
          <p>
            {stats.automaticItems} items handled automatically · {reviewed} items complete ·{' '}
            {excluded} excluded
            {pendingColumns
              ? ` · ${pendingColumns} extra ${pendingColumns === 1 ? 'column needs' : 'columns need'} a decision`
              : ''}
          </p>
          <p>
            AI source checks: {evaluationComplete ? 'complete' : 'pending'} · Proposal coverage:{' '}
            {coverage ? 'complete' : `${unresolvedCells} cells unresolved`} · Export:{' '}
            {blockerCount ? 'not ready' : 'ready'}
          </p>
          <progress
            aria-label="Item review progress"
            max={Math.max(itemCount, 1)}
            value={stats.reviewed + stats.excluded}
          />
        </div>
        <Button onClick={onNext}>{nextLabel}</Button>
      </section>
    </>
  );
}
