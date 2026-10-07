'use client';

import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  busy: boolean;
  onUpload: (file: File) => void;
  onChoose: () => void;
  onCancel: () => void;
};

export function UploadView({ busy, onUpload, onChoose, onCancel }: Props) {
  return (
    <>
      <section
        className="upload"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy && e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={32} />
        <h2>{busy ? 'Reading your proposal…' : 'Upload a bid proposal'}</h2>
        <p>Drag an Excel file here, or choose one from your computer.</p>
        <Button disabled={busy} onClick={onChoose}>
          Choose Excel file
        </Button>
        <small>.xlsx or .xlsm · Maximum 20 MB · Macros are never run</small>
        {busy && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </section>
      <div className="upload-guide">
        <p>
          <strong>1. Upload</strong> Start with the customer’s Excel proposal.
        </p>
        <p>
          <strong>2. Review</strong> Review flagged exceptions. Supported information is accepted
          automatically.
        </p>
        <p>
          <strong>3. Download</strong> Get the completed template, ready for inventory matching.
        </p>
      </div>
    </>
  );
}
