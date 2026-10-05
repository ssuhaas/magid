'use client';
import { useState } from 'react';
import type { Field } from '@/lib/review-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
export function FieldReview({
  label,
  field,
  help,
  acceptBlockedReason,
  source,
  onView,
  onDecision,
  onEdit,
  onAlternative,
}: {
  label: string;
  field: Field;
  help?: string;
  acceptBlockedReason?: string;
  source: { address: string; raw: string; formula?: string | null }[];
  onView: () => void;
  onDecision: (status: string) => void;
  onEdit: (value: string) => void;
  onAlternative: (candidate: Field) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(field.value),
    [base, setBase] = useState(field);
  const changed = editing && base !== field;
  const status =
    field.status === 'auto_evaluated'
      ? 'Source evaluation passed'
      : field.status === 'auto_blank'
        ? 'Blank — no supported value'
        : field.status === 'auto_accepted'
          ? 'Validated from source'
          : field.status === 'pending'
            ? 'Needs review'
            : field.status === 'blank'
              ? 'Left blank'
              : field.status === 'edited'
                ? 'Edited and saved'
                : 'Accepted';
  const explain =
    /Evaluator requires review|potentially missing|conflict|packaging|differs|precision|significant-digit/i.test(
      field.reason,
    )
      ? field.reason
      : field.reason.includes('review this decision again') || field.reason.includes('review again')
        ? 'Review again — related information changed.'
        : field.alternatives?.length
          ? 'Different values were found. Compare the sources before deciding.'
          : !field.value
            ? 'No value is proposed. Check the source, then add a value or leave this blank.'
            : !field.direct
              ? 'Check that this interpretation matches your proposal.'
              : '';
  return (
    <article className="field">
      <div className="field-head">
        <h3>{label}</h3>
        <Badge variant="outline" className={field.status === 'pending' ? 'review' : 'ready'}>
          {status}
        </Badge>
      </div>
      <div className="field-comparison">
        <div>
          <small>In your proposal</small>
          {source.length ? (
            source.map((s) => (
              <p key={s.address}>
                {s.raw || '[Empty source cell]'}
                <small>
                  {s.address}
                  {s.formula ? ' · Formula: ' + s.formula : ''}
                </small>
              </p>
            ))
          ) : (
            <p>No source value linked.</p>
          )}
          <button className="text-button" onClick={onView}>
            View in proposal
          </button>
        </div>
        <div>
          <small>For your output</small>
          {editing ? (
            <Input
              autoFocus
              aria-label={'Edit ' + label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <p className="output-value">{field.value || 'Blank'}</p>
          )}
        </div>
      </div>
      {field.status === 'pending' && explain && <p className="review-reason">{explain}</p>}
      <details>
        <summary>Why this value?</summary>
        {help && <p>{help}</p>}
        <p>
          {field.status === 'auto_evaluated'
            ? 'This value passed extraction source checks and a separate evaluation against the original proposal. ' +
              field.reason
            : field.status === 'auto_blank'
              ? 'No supported value was extracted. This field stays blank without approval.'
              : field.status === 'auto_accepted'
                ? (field.origin === 'source_narrative' && field.evidence.length > 1
                    ? 'Original source cells joined in order. '
                    : 'A deterministic rule validated this value against its source. ') +
                  field.reason
                : field.reason}
        </p>
      </details>
      {field.alternatives?.map((candidate: Field, i: number) => (
        <div className="ai-alternative" key={i}>
          <strong>Another suggested value: {candidate.value}</strong>
          <p>{candidate.reason}</p>
          <small>Source: {candidate.evidence.join(', ')}</small>
          <Button
            variant="outline"
            onClick={() => {
              setEditing(false);
              onAlternative(candidate);
            }}
          >
            Review this suggestion instead
          </Button>
        </div>
      ))}
      {changed && (
        <p role="alert">
          This field changed while you were editing. Cancel and reopen the edit to use the latest
          information.
        </p>
      )}
      {acceptBlockedReason && <p className="review-reason">{acceptBlockedReason}</p>}
      <div className="field-actions">
        {editing ? (
          <>
            <Button
              disabled={changed}
              onClick={() => {
                onEdit(draft);
                setEditing(false);
              }}
            >
              Save changes
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {!['auto_blank', 'auto_accepted', 'auto_evaluated'].includes(field.status) && (
              <Button
                variant="outline"
                disabled={!!acceptBlockedReason}
                onClick={() => onDecision(field.value ? 'accepted' : 'blank')}
              >
                {field.value ? 'Accept' : 'Confirm blank'}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(field.value);
                setBase(field);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            {field.value && (
              <Button variant="ghost" onClick={() => onDecision('blank')}>
                Leave blank
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
