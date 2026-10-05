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
}) {
  let proposed = baseline;
  const metadata = {};
  const notices = [];
  const evaluations = [];
  const issues = [];
  const debug = (stage, status, message) => observer({ stage, status, message });
  if (!scopes.length) throw Error('Map items or choose source rows first.');
  for (let i = 0; i < scopes.length; i++) {
    check();
    let envelope;
    try {
      envelope = await process(scopes[i], {
        cache,
        check,
        signal,
        observer,
        progress: (stage, waitMessage) => {
          if (stage === 'waiting') {
            progress(
              waitMessage ||
                'Waiting for another proposal’s AI request to finish. Processing will resume automatically; you can cancel.',
            );
            return;
          }
          progress(
            `Group ${i + 1} of ${scopes.length}: ${stage === 'extract' ? 'extracting supported values' : 'checking values against the original proposal'}. Completed stages are kept for retry in this temporary session.`,
          );
          debug(
            stage === 'extract' ? 'ai' : 'evaluate',
            'running',
            `Processing group ${i + 1} of ${scopes.length}.`,
          );
        },
      });
    } catch (e) {
      if ([504, 413].includes(e.status) && scopes[i].records.length > 1) {
        const old = scopes[i];
        const parts = old.records.map((record) =>
          buildScope(
            book,
            baseline.filter((r) => r.id === record.id),
            { digest: sourceDigest, scopeId: createScopeId() },
          ),
        );
        scopes.splice(i, 1, ...parts);
        i--;
        debug('ai', 'retrying', 'Timed-out or incomplete group reduced to one item per request.');
        continue;
      }
      throw e;
    }
    const evaluated = validateEvaluation(
      { source: scopes[i], proposal: envelope.proposal },
      envelope.evaluation,
    );
    evaluations.push(evaluated);
    issues.push(...(envelope.issues || []));
    const applied = applyProposal(proposed, book, scopes[i], envelope);
    proposed = applied.records;
    Object.assign(metadata, applied.meta);
    notices.push(...applied.notices);
  }
  check();
  if (proposed.length > 2000) throw Error('AI result exceeds 2,000 items.');
  return { proposed, metadata, notices, evaluations, issues };
}
