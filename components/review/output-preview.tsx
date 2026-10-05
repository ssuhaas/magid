'use client';
import { useState } from 'react';
import type { Book, Item, SourceSelection } from '@/lib/review-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { reviewStats } from '@/lib/ui/review.mjs';
import { fieldContracts } from '@/lib/canonical/field-contracts.mjs';
export function OutputPreview({
  open,
  onClose,
  items,
  columns,
  book,
  onSource,
}: {
  open: boolean;
  onClose: () => void;
  items: Item[];
  columns: Record<string, string>;
  book: Book | null;
  onSource: (s: SourceSelection) => void;
}) {
  const [page, setPage] = useState(0),
    [cell, setCell] = useState<{ id: string; key: string } | null>(null);
  const stats = reviewStats(items, columns, null, book),
    rows = items.filter((r) => r.boundary === 'include'),
    extras = Object.keys(columns).filter((k) => columns[k] === 'approved'),
    headers = [
      ...Object.entries(fieldContracts).map(([key, c]) => ({ key, label: c.header })),
      ...extras.map((key) => ({ key, label: key })),
    ];
  const row = rows.find((r) => r.id === cell?.id),
    field = row && (row.values[cell?.key || ''] || row.extras[cell?.key || '']),
    sequence = cell?.key === 'A',
    sources =
      field?.evidence.map((a: string) => ({
        address: a,
        cell: book?.sheets.find((s) => s.name === row!.sheet)?.cells[a],
      })) || [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="output-dialog">
        <DialogHeader>
          <DialogTitle>Your prepared spreadsheet</DialogTitle>
          <DialogDescription>
            {rows.length} included items · {stats.pendingItems} items pending review. Click any cell
            to see its source and the reason for its value. These are the current values for the
            identification worksheet.
          </DialogDescription>
        </DialogHeader>
        <div className="output-preview">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h.key}>{h.label.replaceAll('\n', ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(currentPage * 50, currentPage * 50 + 50).map((r, i) => (
                <tr key={r.id}>
                  {headers.map((h) => (
                    <td key={h.key}>
                      <button
                        className={
                          cell?.id === r.id && cell?.key === h.key ? 'selected-output-cell' : ''
                        }
                        aria-label={`Row ${currentPage * 50 + i + 2}, ${h.label.replaceAll('\n', ' ')}`}
                        onClick={() => setCell({ id: r.id, key: h.key })}
                      >
                        {h.key === 'A'
                          ? currentPage * 50 + i + 1
                          : r.values[h.key]?.value || r.extras[h.key]?.value || 'Blank'}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <Button
            variant="outline"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous rows
          </Button>
          <span>
            {rows.length ? currentPage * 50 + 1 : 0}–{Math.min(rows.length, currentPage * 50 + 50)}{' '}
            of {rows.length}
          </span>
          <Button
            variant="outline"
            disabled={(currentPage + 1) * 50 >= rows.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next rows
          </Button>
        </div>
        {row && cell ? (
          <section className="output-cell-detail" aria-live="polite">
            <h3>
              {headers.find((h) => h.key === cell.key)?.label.replaceAll('\n', ' ')} · Output row{' '}
              {rows.indexOf(row) + 2}
            </h3>
            <p>
              <strong>Output value:</strong>{' '}
              {sequence ? rows.indexOf(row) + 1 : field?.value || 'Blank'}
            </p>
            <p>
              <strong>Why:</strong>{' '}
              {sequence
                ? 'Generated sequentially for included output items. This number is not a source identifier.'
                : field?.status === 'auto_evaluated'
                  ? 'Source-backed extraction passed a separate evaluation against the original proposal. ' +
                    field.reason
                  : field?.status === 'auto_blank'
                    ? 'No supported value was extracted. This cell stays blank automatically.'
                    : field?.status === 'blank'
                      ? 'The reviewer chose to leave this cell blank.'
                      : field?.status === 'edited'
                        ? 'The reviewer edited and saved this value. ' + field.reason
                        : field?.status === 'auto_accepted'
                          ? (field.origin === 'source_narrative' && field.evidence.length > 1
                              ? 'Original source cells joined in order. '
                              : 'Validated by a deterministic source rule. ') + field.reason
                          : field?.reason || 'No value supplied for this additional column.'}
            </p>
            {!sequence && (
              <>
                <p>
                  <strong>Original proposal values:</strong>
                </p>
                {sources.length ? (
                  sources.map((s) => (
                    <p key={s.address}>
                      {row.sheet}!{s.address}: {s.cell?.raw || '[Empty cell]'}
                      {s.cell?.formula ? ' (unverified formula result)' : ''}
                    </p>
                  ))
                ) : (
                  <p>No source value is linked to this cell.</p>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    onSource({
                      sheet: row.sheet,
                      addresses: sources.length ? field!.evidence : row.anchors,
                      contextOnly: !sources.length,
                      label: headers.find((h) => h.key === cell.key)?.label.replaceAll('\n', ' '),
                    })
                  }
                >
                  View in proposal
                </Button>
              </>
            )}
          </section>
        ) : (
          <p>Select a cell above to inspect it.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
