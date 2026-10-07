'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Item } from '@/lib/review-types';

type Props = {
  item: Item | null;
  items: Item[];
  itemPosition: number;
  totalItems: number;
  pendingFieldCount: number;
  automaticallyIncluded: boolean;
  mergeId: string;
  nextLabel: string;
  children: ReactNode;
  onViewSource: () => void;
  onInclude: () => void;
  onExclude: () => void;
  onSplit: () => void;
  onMergeSelection: (id: string) => void;
  onMerge: () => void;
  onNext: () => void;
  onPreview: () => void;
  onIdentifyColumns: () => void;
};

export function ReviewItemDetails({
  item,
  items,
  itemPosition,
  totalItems,
  pendingFieldCount,
  automaticallyIncluded,
  mergeId,
  nextLabel,
  children,
  onViewSource,
  onInclude,
  onExclude,
  onSplit,
  onMergeSelection,
  onMerge,
  onNext,
  onPreview,
  onIdentifyColumns,
}: Props) {
  return (
    <section className="details">
      {item ? (
        <>
          <div className="panel-head">
            <div>
              <small>
                Item {itemPosition} of {totalItems} total · {pendingFieldCount} fields pending
                {item.boundary === 'pending' ? ' · inclusion needs confirmation' : ''}
              </small>
              <h2>{item.values.E.value || 'Review this item'}</h2>
            </div>
            <Button variant="outline" onClick={onViewSource}>
              View in proposal
            </Button>
          </div>
          <div className="boundary">
            <h3>
              {item.boundary === 'pending'
                ? 'Should this be an item in your output?'
                : 'Item inclusion'}
            </h3>
            <p>
              {item.boundary === 'include'
                ? automaticallyIncluded
                  ? 'Automatically included: ' + item.boundaryReason
                  : 'Included by your decision. Check any remaining exceptions below.'
                : item.boundary === 'exclude'
                  ? 'Excluded from your output. You can include it again if needed.'
                  : item.boundaryReason}
            </p>
            <div className="buttons">
              {item.boundary !== 'include' && (
                <Button variant="outline" onClick={onInclude}>
                  Include item
                </Button>
              )}
              <Button variant="outline" onClick={onExclude}>
                Exclude item
              </Button>
            </div>
            <details>
              <summary>This is more than one item, or belongs with another row</summary>
              <p>{item.boundaryReason}</p>
              {item.ambiguous && (
                <Button variant="outline" onClick={onSplit}>
                  Separate into individual items
                </Button>
              )}
              <label>
                Combine with
                <select value={mergeId} onChange={(e) => onMergeSelection(e.target.value)}>
                  <option value="">Choose another item…</option>
                  {items
                    .filter(
                      (r) => r.id !== item.id && r.sheet === item.sheet && r.boundary !== 'exclude',
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.anchors.join(', ')} · {(r.values.E.value || 'Item').slice(0, 60)}
                      </option>
                    ))}
                </select>
              </label>
              <Button variant="outline" disabled={!mergeId} onClick={onMerge}>
                Combine items and review
              </Button>
            </details>
          </div>
          {children}
          <div className="next-item">
            <Button onClick={onNext}>{nextLabel}</Button>
          </div>
        </>
      ) : (
        <div className="empty">
          <h2>{items.length ? 'No item exceptions in this view' : 'No items identified'}</h2>
          <p>
            {items.length
              ? 'Supported fields are handled automatically. You can inspect every value in the spreadsheet preview.'
              : 'Help identify the proposal columns to continue.'}
          </p>
          {items.length ? (
            <Button variant="outline" onClick={onPreview}>
              View spreadsheet and sources
            </Button>
          ) : (
            <Button onClick={onIdentifyColumns}>Identify columns</Button>
          )}
        </div>
      )}
    </section>
  );
}
