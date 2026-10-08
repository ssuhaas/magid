// @ts-check
import { buildScope, applyExtractionIssues } from './client.mjs';
import { planEnrichmentScopes, scopeMaxItems, scopeWork } from './scope-planner.mjs';
import { processProposalScopes } from './process-proposal.mjs';
import { deterministicCompleteness, verifyDeterministicSkips } from '../canonical/completeness.mjs';
import {
  automateBoundaries,
  automateCoverage,
  applyEvaluationFindings,
  pruneRedundantExtras,
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
  book,
  baseline,
  sourceDigest,
  sessionCache,
  generation,
  revision,
  discover,
  selection: { sheet, start, end },
  check,
  signal,
  observer,
  progress,
  concurrency = 2,
  maxItems = 3,
  createScopeId = () => crypto.randomUUID(),
  process,
}) {
  const groupLimit = scopeMaxItems(maxItems);
  check();
  if (signal.aborted) throw Error('AI processing canceled.');
  const deterministicSkippedIds = discover
    ? []
    : baseline.filter((r) => deterministicCompleteness(r, book)).map((r) => r.id);
  const skipped = new Set(deterministicSkippedIds);
  const unresolved = baseline.filter((r) => !skipped.has(r.id));
  const key = JSON.stringify([
    generation,
    revision,
    sourceDigest,
    discover,
    sheet,
    start,
    end,
    groupLimit,
    deterministicSkippedIds,
    baseline,
  ]);
  if (sessionCache.plan?.key !== key) {
    sessionCache.stages.clear();
    sessionCache.plan = {
      key,
      scopes: discover
        ? [
            buildScope(book, [], {
              mode: 'discover',
              digest: sourceDigest,
              scopeId: createScopeId(),
              sheet,
              start: Number(start),
              end: Number(end),
            }),
          ]
        : planEnrichmentScopes(book, unresolved, {
            digest: sourceDigest,
            maxItems: groupLimit,
            createScopeId,
          }),
    };
  }
  const scopes = sessionCache.plan.scopes;
  observer({
    stage: 'ai',
    status: 'planned',
    message:
      'Proven complete stock-list rows skip AI. Remaining rows receive targeted extraction and independent source checks.',
    detail: {
      ...scopeWork(scopes),
      items: baseline.length,
      deterministicSkippedItems: deterministicSkippedIds.length,
      aiItems: discover ? 0 : unresolved.length,
      deterministicSkipRule: 'closed-stock-lane-v1',
      concurrency,
      maxItems: groupLimit,
    },
  });
  const started = performance.now();
  const measured = {
    extractionRequests: 0,
    evaluationRequests: 0,
    failedRequests: 0,
    requestMilliseconds: 0,
  };
  /** @param {import('./types').DiagnosticEvent} event */
  const observe = (event) => {
    const detail =
      /** @type {{stage?: unknown, outcome?: unknown, milliseconds?: unknown} | undefined} */ (
        event.detail
      );
    if (
      event.status === 'timed' &&
      detail &&
      typeof detail.milliseconds === 'number' &&
      Number.isFinite(detail.milliseconds) &&
      detail.milliseconds >= 0
    ) {
      if (detail.stage === 'extract') measured.extractionRequests++;
      else if (detail.stage === 'evaluate') measured.evaluationRequests++;
      if (detail.outcome !== 'completed') measured.failedRequests++;
      measured.requestMilliseconds += detail.milliseconds;
    }
    observer(event);
  };
  let completed = false;
  try {
    const result =
      !discover && baseline.length && !scopes.length
        ? { proposed: structuredClone(baseline), metadata: {}, notices: [], evaluations: [], issues: [] }
        : await processProposalScopes({
            book,
            baseline,
            scopes,
            sourceDigest,
            cache: sessionCache.stages,
            check,
            signal,
            observer: observe,
            progress,
            concurrency,
            createScopeId,
            process,
          });
    check();
    if (signal.aborted) throw Error('AI processing canceled.');
    verifyDeterministicSkips(baseline, result.proposed, book, deterministicSkippedIds);
    completed = true;
    return { ...result, deterministicSkippedIds };
  } finally {
    // A final aggregate survives bounded debug history. Timings never authorize output.
    try {
      observer({
        stage: 'ai',
        status: 'measured',
        message: 'AI processing run measurement.',
        detail: {
          ...measured,
          groupsAfterSplitting: scopes.length,
          deterministicSkippedItems: deterministicSkippedIds.length,
          elapsedMilliseconds: Math.max(0, Math.round(performance.now() - started)),
          outcome: signal.aborted ? 'canceled' : completed ? 'completed' : 'failed',
        },
      });
    } catch {
      /* Optional measurement cannot change the run result. */
    }
  }
}

/**
 * Check ownership after the async runner yields, then apply policy synchronously.
 * Call and publish returned records in the same turn, without an intervening await.
 * This remains separate from source coverage and the independent final export gate.
 * @param {import('./types').FinalizeNormalizationOptions} options
 */
export function finalizeNormalization({ book, baseline, result, controller, columns, check }) {
  check();
  verifyDeterministicSkips(baseline, result.proposed, book, result.deterministicSkippedIds || []);
  const skipped = new Set(result.deterministicSkippedIds || []);
  for (const record of baseline) {
    if (
      !skipped.has(record.id) &&
      !result.evaluations.some((e) => e.items.some((v) =>
        v.recordId === record.id && v.sheet === record.sheet &&
        JSON.stringify(v.anchors) === JSON.stringify(record.anchors)))
    )
      throw Error('An unresolved row is missing its independent AI check.');
  }
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
