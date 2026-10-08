'use client';

import { Button } from '@/components/ui/button';

type Props = {
  aiBusy: boolean;
  aiProgress: string;
  retryDisabled: boolean;
  onCancel: () => void;
  onRetry: () => void;
};

export function AiProcessingPanel({ aiBusy, aiProgress, retryDisabled, onCancel, onRetry }: Props) {
  return (
    <section className="ai-panel" aria-label="AI processing">
      <strong>{aiBusy ? 'Preparing your proposal with AI…' : 'AI processing'}</strong>
      <p role="status">
        {aiProgress ||
          'AI starts automatically after upload. Verified copies and unsupported blanks do not need field approval.'}
      </p>
      <div className="buttons">
        {aiBusy ? (
          <Button variant="outline" onClick={onCancel}>
            Cancel AI processing
          </Button>
        ) : (
          <Button variant="outline" disabled={retryDisabled} onClick={onRetry}>
            Retry AI processing
          </Button>
        )}
      </div>
    </section>
  );
}
