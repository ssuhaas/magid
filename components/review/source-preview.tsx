'use client';
import { useState } from 'react';
import type { Book, SourceSelection } from '@/lib/review-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { colName } from '@/lib/workbook.mjs';
import { spreadsheetWindow } from '@/lib/ui/review.mjs';
export function SourcePreview({
  book,
  selection,
  onClose,
}: {
  book: Book | null;
  selection: SourceSelection | null;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState('');
  const sheet = book?.sheets.find((s) => s.name === selection?.sheet),
    addresses = selection?.addresses || [],
    focus = addresses.includes(chosen) ? chosen : addresses[0] || 'A1',
    window = sheet ? spreadsheetWindow(sheet, focus) : null;
  return (
    <Dialog
      open={!!selection}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="source-dialog">
        <DialogHeader>
          <DialogTitle>View in proposal</DialogTitle>
          <DialogDescription>
            {selection?.sheet} ·{' '}
            {selection?.contextOnly
              ? 'Highlighted cells show item context. No exact source value is linked to this field.'
              : 'Highlighted cells are the original values cited for this item or field.'}{' '}
            This preview shows stored values, not the workbook’s original formatting.
          </DialogDescription>
        </DialogHeader>
        {sheet && window && (
          <>
            {!selection?.contextOnly && (
              <section className="original-values">
                <strong>
                  Original proposal values{selection?.label ? ` — ${selection.label}` : ''}
                </strong>
                {addresses.map((a) => (
                  <p key={a}>
                    <small>
                      {sheet.name}!{a}
                    </small>
                    {sheet.cells[a]?.displayedText || sheet.cells[a]?.raw || '[Empty source cell]'}
                    {sheet.cells[a]?.displayedText && (
                      <small>Stored value: {sheet.cells[a].raw}</small>
                    )}
                  </p>
                ))}
              </section>
            )}
            <label>
              Go to a cited cell
              <select value={focus} onChange={(e) => setChosen(e.target.value)}>
                {(addresses.length ? addresses : ['A1']).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {sheet.hidden !== 'visible' && (
              <p className="notice">This sheet is hidden in the original workbook.</p>
            )}
            <div className="sheet-preview">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    {Array.from(
                      { length: window.endColumn - window.startColumn + 1 },
                      (_, i) => window.startColumn + i,
                    ).map((c) => (
                      <th scope="col" key={c}>
                        {colName(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {window.rows.map((row) => (
                    <tr key={row}>
                      <th scope="row">
                        {row}
                        {sheet.hiddenRows.includes(String(row)) && <small>Hidden</small>}
                      </th>
                      {Array.from(
                        { length: window.endColumn - window.startColumn + 1 },
                        (_, i) => window.startColumn + i,
                      ).map((c) => {
                        const a = colName(c) + row,
                          cell = sheet.cells[a],
                          highlight = addresses.includes(a);
                        return (
                          <td key={a} className={highlight ? 'cited-cell' : ''}>
                            <small>{highlight ? 'Cited cell ' + a : a}</small>
                            {cell?.displayedText || cell?.raw || '—'}
                            {cell?.displayedText && <small>Stored value: {cell.raw}</small>}
                            {cell?.formula && (
                              <small>
                                Formula: {cell.formula}
                                <br />
                                Stored result requires verification.
                              </small>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>
              Nearby rows and the first three rows are shown. Row numbers identify any gaps.
            </small>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
