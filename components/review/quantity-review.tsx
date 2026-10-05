'use client';
import { useState } from 'react';
import type { Book, Item } from '@/lib/review-types';
import { Button } from '@/components/ui/button';
import { formulaReview, packagingReview } from '@/lib/canonical/quantity-review.mjs';
export function QuantityReview({
  record,
  book,
  onFormula,
  onPackaging,
  onView,
}: {
  record: Item;
  book: Book;
  onFormula: () => void;
  onPackaging: (keepAnnual: boolean) => void;
  onView: (addresses: string[]) => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    p = packagingReview(record, book),
    formula = formulaReview(record, book);
  if (!p && !formula) return null;
  const unit = p?.container || record.values.L.value,
    annual = p?.annual || formula,
    canKeep = !!annual && (!formula || formula.ok) && !!unit;
  return (
    <section className="quantity-review boundary" aria-label="Quantity and packaging review">
      <h3>{p ? 'Confirm how this item is purchased' : 'Check the annual calculation'}</h3>
      {p && (
        <>
          <p>
            <strong>In the proposal:</strong> {p.raw}{' '}
            <small>
              ({record.sheet}!{p.address})
            </small>
          </p>
          <p>
            <strong>For the output:</strong> {p.count} {p.content === 'PR' ? 'pairs' : 'contents'}{' '}
            per {p.container === 'BX' ? 'box' : p.container === 'BG' ? 'bag' : 'dozen'} (
            {p.container}).{!p.content && ' The source does not identify the unit of the contents.'}
          </p>
          <p>We keep this count as written. Pairs are not converted into individual pieces.</p>
        </>
      )}
      {formula && (
        <>
          <p>
            <strong>Original formula:</strong> <code>{formula.cell.formula}</code>
          </p>
          <p>
            <strong>Excel’s saved result:</strong> {formula.cached}
            {formula.ok ? ` · Independently checked: ${formula.result}` : ''}
          </p>
          <p>
            {formula.ok
              ? 'The arithmetic matches. The calculation alone does not establish the annual period or purchasing unit.'
              : formula.reason}
          </p>
        </>
      )}
      {annual && (
        <p>
          <strong>Source heading:</strong> {annual.heading} ({annual.header})<br />
          <strong>Annual quantity:</strong> {record.values.K.value} ·{' '}
          <strong>Proposed purchasing unit:</strong> {unit || 'Not established'}
        </p>
      )}
      <Button
        variant="ghost"
        onClick={() =>
          onView([
            ...new Set([p?.address, annual?.address, annual?.header].filter(Boolean)),
          ] as string[])
        }
      >
        View quantity and packaging in proposal
      </Button>
      {canKeep ? (
        <label className="coverage-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{' '}
          I checked the annual period and confirmed that this quantity counts{' '}
          {p ? 'containers in ' : ''}
          {unit}.
        </label>
      ) : (
        <p>
          The annual quantity or purchasing unit cannot be verified here. Leave Annual Usage blank,
          or review the source and edit the fields individually.
        </p>
      )}
      <div className="buttons">
        {p ? (
          <>
            <Button
              disabled={!confirmed || !canKeep || record.boundary !== 'include'}
              onClick={() => onPackaging(true)}
            >
              Confirm packaging and annual unit
            </Button>
            <Button
              variant="outline"
              disabled={record.boundary !== 'include'}
              onClick={() => onPackaging(false)}
            >
              Confirm packaging; leave annual usage blank
            </Button>
          </>
        ) : (
          <Button
            disabled={!confirmed || !canKeep || record.boundary !== 'include'}
            onClick={onFormula}
          >
            Confirm annual calculation and unit
          </Button>
        )}
      </div>
      <small>
        Confirm only what the proposal supports. If the relationship is unclear, leaving a value
        blank avoids an unsupported conversion.
      </small>
    </section>
  );
}
