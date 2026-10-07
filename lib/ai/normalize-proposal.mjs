// @ts-check
import { buildScope, applyExtractionIssues } from './client.mjs';
import { processProposalScopes } from './process-proposal.mjs';
import {
  automateBoundaries, automateCoverage, applyEvaluationFindings, pruneRedundantExtras,
} from '../canonical/pipeline.mjs';

/** @returns {import('./types').NormalizationCache} */
export function createNormalizationCache() {
  return { stages: new Map(), plan: null };
}

/**
 * Preserve source/review values while applying the existing deterministic policy.
 * @param {import('../review-types').Book} book
 * @param {import('../review-types').Item[]} items
 * @param {import('./types').ReviewController} controller
 * @param {import('./types').ColumnDecisions} columns
 */
export function prepareNormalization(book, items, controller, columns) {
  const baseline = structuredClone(items);
  automateBoundaries(controller, baseline, book);
  controller.automate(baseline, book);
  automateCoverage(controller, book, baseline, columns);
  return baseline;
}

/**
 * Run from parsed source without React. Results are staged, not controller approvals.
 * Scope splitting and completed stages stay in the supplied temporary retry cache.
 * @param {import('./types').NormalizationOptions} options
 * @returns {Promise<import('./types').ProposalProcessingResult>}
 */
export async function runNormalization({
  book, baseline, sourceDigest, sessionCache, generation, revision, discover,
  selection: { sheet, start, end }, check, signal, observer, progress,
  concurrency = 2, createScopeId = () => crypto.randomUUID(), process,
}) {
  const key = JSON.stringify([
    generation, revision, sourceDigest, discover, sheet, start, end,
    baseline.map(r => [
      r.id, r.anchors,
      Object.fromEntries(Object.entries(r.values).map(([k, f]) => [k, f.value])),
    ]),
  ]);
  if (sessionCache.plan?.key !== key) {
    sessionCache.stages.clear();
    sessionCache.plan = {
      key,
      scopes: discover
        ? [buildScope(book, [], {
            mode: 'discover', digest: sourceDigest, scopeId: createScopeId(),
            sheet, start: Number(start), end: Number(end),
          })]
        : Array.from({ length: Math.ceil(baseline.length / 3) }, (_, i) =>
            buildScope(book, baseline.slice(i * 3, i * 3 + 3), {
              digest: sourceDigest, scopeId: createScopeId(), targeted: true,
            })),
    };
  }
  const scopes = sessionCache.plan.scopes;
  observer({
    stage: 'ai', status: 'planned',
    message: 'AI generation is limited to unresolved fields; independent source checks cover every item.',
    detail: {
      groups: scopes.length, items: baseline.length, concurrency,
      requestedFields: scopes.flatMap(s => s.records)
        .reduce((n, r) => n + (r.requestedColumns?.length ?? 12), 0),
    },
  });
  return processProposalScopes({
    book, baseline, scopes, sourceDigest, cache: sessionCache.stages,
    check, signal, observer, progress, concurrency, createScopeId, process,
  });
}

/**
 * Check ownership after the async runner yields, then apply policy synchronously.
 * Call and publish returned records in the same turn, without an intervening await.
 * This remains separate from source coverage and the independent final export gate.
 * @param {import('./types').FinalizeNormalizationOptions} options
 */
export function finalizeNormalization({ book, baseline, result, controller, columns, check }) {
  check();
  const { proposed, evaluations, issues } = result;
  applyEvaluationFindings(proposed, evaluations, controller);
  pruneRedundantExtras(proposed, columns);
  controller.reconcile(baseline, proposed);
  automateBoundaries(controller, proposed, book);
  controller.automate(proposed, book);
  controller.evaluate(proposed, book, evaluations);
  applyExtractionIssues(proposed, issues, book);
  // Quarantined fields cannot retain a prior automatic approval.
  controller.automate(proposed, book);
  return proposed;
}
