import { processStages } from './stages.mjs';
import { buildScope, applyProposal } from './client.mjs';
import { validateEvaluation } from './evaluation.mjs';

/**
 * Stage all source groups before the caller commits records or controller proofs.
 * `scopes` is the session-owned queue: splitting it in place preserves retry behavior.
 * A failed, canceled, or stale run returns no partially prepared records.
 * @param {object} options
 * @param {any} options.book
 * @param {any[]} options.baseline
 * @param {any[]} options.scopes
 * @param {string} options.sourceDigest
 * @param {Map} options.cache
 * @param {() => void} options.check
 * @param {AbortSignal} options.signal
 * @param {(event: any) => void} options.observer
 * @param {(message: string) => void} options.progress
 * @param {() => string} [options.createScopeId]
 * @param {number} [options.concurrency]
 * @param {typeof processStages} [options.process]
 */
export async function processProposalScopes({
  book,
  baseline,
  scopes,
  sourceDigest,
  cache,
  check,
  signal,
  observer,
  progress,
  createScopeId = () => crypto.randomUUID(),
  process = processStages,
  concurrency = 2,
}) {
  let proposed = baseline;
  const metadata = {};
  const notices = [];
  const evaluations = [];
  const issues = [];
  const debug = (stage, status, message) => observer({ stage, status, message });
  if (!scopes.length) throw Error('Map items or choose source rows first.');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const staged = new Map();
  const queue = [...scopes];
  let completed = 0;
  let failure;
  const current = () => {
    check();
    if (abort.signal.aborted) throw failure || Error('AI processing canceled.');
  };
  const worker = async () => {
    try {
      while (queue.length) {
        current();
        const scope = queue.shift();
        let envelope;
        try {
          envelope = await process(scope, {
            cache, check: current, signal: abort.signal, observer,
            progress: (stage, waitMessage) => {
              current();
              const label = `Checked ${completed} of ${scopes.length} groups.`;
              progress(stage === 'waiting'
                ? `${label} ${waitMessage || 'Waiting for a free AI slot; you can cancel.'}`
                : `${label} ${stage === 'extract' ? 'Extracting unresolved values' : 'Checking values against the original proposal'}.`);
              debug(stage === 'extract' ? 'ai' : 'evaluate', 'running', label);
            },
          });
        } catch (e) {
          current();
          if ([504, 413].includes(e.status) && scope.records.length > 1) {
            const parts = scope.records.map(record => buildScope(book,
              baseline.filter(r => r.id === record.id), {
                digest: sourceDigest, scopeId: createScopeId(),
                targeted: scope.records.some(r => r.requestedColumns !== undefined),
              }));
            scopes.splice(scopes.indexOf(scope), 1, ...parts);
            queue.push(...parts);
            debug('ai', 'retrying', 'Timed-out or incomplete group reduced to one item per request.');
            continue;
          }
          throw e;
        }
        current();
        staged.set(scope.scopeId, envelope);
        completed++;
        progress(`Checked ${completed} of ${scopes.length} groups. Completed stages are kept for retry in this temporary session.`);
      }
    } catch (e) {
      if (!failure) failure = e;
      abort.abort();
    }
  };
  try {
    const limit = Number.isInteger(concurrency) ? Math.min(2, Math.max(1, concurrency)) : 2;
    await Promise.all(Array.from({ length: Math.min(limit, scopes.length) }, worker));
    if (failure) throw failure;
    current();
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  // Apply in source order, never network completion order. No partial commit on failure.
  for (const scope of scopes) {
    check();
    const envelope = staged.get(scope.scopeId);
    const evaluated = validateEvaluation(
      { source: scope, proposal: envelope.proposal },
      envelope.evaluation,
    );
    evaluations.push(evaluated);
    issues.push(...(envelope.issues || []));
    const applied = applyProposal(proposed, book, scope, envelope);
    proposed = applied.records;
    Object.assign(metadata, applied.meta);
    notices.push(...applied.notices);
  }
  check();
  if (proposed.length > 2000) throw Error('AI result exceeds 2,000 items.');
  return { proposed, metadata, notices, evaluations, issues };
}
