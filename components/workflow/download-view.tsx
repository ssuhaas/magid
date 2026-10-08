'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  downloaded: boolean;
  blockers: string[];
  included: number;
  pendingItems: number;
  addedColumns: number;
  remainingCount: number;
  itemCount: number;
  lostIdentifierCount: number;
  pendingColumns: number;
  coverage: boolean;
  coverageErrorCount: number;
  unconfirmedSheetCount: number;
  unresolvedCells: number;
  finalBlockerCount: number;
  busy: boolean;
  aiBusy: boolean;
  saveFile: { url: string; name: string } | null;
  onReviewExceptions: () => void;
  onIdentifyColumns: () => void;
  onReviewColumns: () => void;
  onReviewSource: () => void;
  onReviewAllItems: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onSave: () => void;
  onContinueReview: () => void;
};

export function DownloadView({
  downloaded,
  blockers,
  included,
  pendingItems,
  addedColumns,
  remainingCount,
  itemCount,
  lostIdentifierCount,
  pendingColumns,
  coverage,
  coverageErrorCount,
  unconfirmedSheetCount,
  unresolvedCells,
  finalBlockerCount,
  busy,
  aiBusy,
  saveFile,
  onReviewExceptions,
  onIdentifyColumns,
  onReviewColumns,
  onReviewSource,
  onReviewAllItems,
  onPreview,
  onDownload,
  onSave,
  onContinueReview,
}: Props) {
  return (
    <section className="panel export">
      <h2>
        {downloaded
          ? 'Your spreadsheet has been prepared.'
          : blockers.length
            ? 'Finish the remaining checks.'
            : 'Ready to download.'}
      </h2>
      <p>
        {included} included items · {pendingItems} items pending review · 13 original template
        columns
        {addedColumns > 0 ? ` · ${addedColumns} added columns` : ''}
      </p>
      {blockers.length > 0 && (
        <div className="download-checklist">
          {remainingCount > 0 && (
            <button onClick={onReviewExceptions}>
              <span>
                Review {remainingCount} remaining {remainingCount === 1 ? 'item' : 'items'}
              </span>
              <strong>Review items</strong>
            </button>
          )}
          {!itemCount && (
            <button onClick={onIdentifyColumns}>
              <span>No items have been identified</span>
              <strong>Identify columns</strong>
            </button>
          )}
          {lostIdentifierCount > 0 && (
            <button onClick={onReviewColumns}>
              <span>{lostIdentifierCount} items would lose their source product codes</span>
              <strong>Keep product codes</strong>
            </button>
          )}
          {pendingColumns > 0 && (
            <button onClick={onReviewColumns}>
              <span>
                Decide whether to add {pendingColumns} extra{' '}
                {pendingColumns === 1 ? 'column' : 'columns'}
              </span>
              <strong>Review information</strong>
            </button>
          )}
          {(!coverage || coverageErrorCount > 0) && (
            <button onClick={onReviewSource}>
              <span>
                {unconfirmedSheetCount
                  ? `Check ${unconfirmedSheetCount} remaining ${unconfirmedSheetCount === 1 ? 'sheet' : 'sheets'}`
                  : 'Confirm all sheets have been checked'}
                {unresolvedCells ? ` · ${unresolvedCells} cells to check` : ''}
              </span>
              <strong>Check proposal</strong>
            </button>
          )}
          <details open={!remainingCount && !pendingColumns && coverage}>
            <summary>All remaining checks ({blockers.length})</summary>
            {blockers.map((b) => (
              <p key={b}>{b}</p>
            ))}
            {finalBlockerCount > 0 && (
              <Button variant="outline" onClick={onReviewAllItems}>
                Return to items to resolve these checks
              </Button>
            )}
          </details>
        </div>
      )}
      {included > 0 && (
        <Button variant="outline" disabled={busy || aiBusy} onClick={onPreview}>
          View spreadsheet and sources
        </Button>
      )}
      {included > 0 && blockers.length > 0 && (
        <p>The preview contains current values. Finish the remaining checks before downloading.</p>
      )}
      <Button disabled={busy || aiBusy || !!blockers.length} onClick={onDownload}>
        <Download size={18} />
        {busy ? 'Checking and preparing Excel…' : 'Download Excel'}
      </Button>
      <p>Prepared for inventory matching. Items have not been matched to inventory yet.</p>
      {saveFile && (
        <p>
          <a className="text-button" href={saveFile.url} download={saveFile.name} onClick={onSave}>
            Save Excel file
          </a>
        </p>
      )}
      {downloaded && (
        <>
          <p>
            Your spreadsheet passed the export checks. Click Save Excel file to save it. If your
            browser does not start the download, click the link again. The file remains available
            during this temporary session.
          </p>
          <Button variant="outline" onClick={onContinueReview}>
            Continue reviewing
          </Button>
        </>
      )}
      <small>
        Prototype testing is still in progress. Check the downloaded workbook before using it for a
        live bid.
      </small>
    </section>
  );
}
