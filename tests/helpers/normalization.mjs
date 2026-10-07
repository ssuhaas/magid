import { createReviewController } from '../../lib/canonical/bridge.mjs';
import {
  automateBoundaries, automateCoverage, applyEvaluationFindings, pruneRedundantExtras,
} from '../../lib/canonical/pipeline.mjs';
import { applyExtractionIssues } from '../../lib/ai/client.mjs';

// Frozen page sequencing from before the extraction, for behavior-parity checks.
export function legacyPrepare(book, items, controller, columns) {
  const baseline = structuredClone(items);
  automateBoundaries(controller, baseline, book);
  controller.automate(baseline, book);
  automateCoverage(controller, book, baseline, columns);
  return baseline;
}
export function legacyFinalize(book, baseline, result, controller, columns) {
  const { proposed, evaluations, issues } = result;
  applyEvaluationFindings(proposed, evaluations, controller);
  pruneRedundantExtras(proposed, columns);
  controller.reconcile(baseline, proposed);
  automateBoundaries(controller, proposed, book);
  controller.automate(proposed, book);
  controller.evaluate(proposed, book, evaluations);
  applyExtractionIssues(proposed, issues, book);
  controller.automate(proposed, book);
  return proposed;
}
export function controllerState(controller) {
  const maps = Object.fromEntries(Object.entries(controller)
    .filter(([, value]) => value instanceof Map)
    .map(([name, value]) => [name, [...value]]));
  return JSON.parse(JSON.stringify({
    maps, revision: controller.revision,
    evaluationRequired: controller.evaluationRequired,
    evaluationComplete: controller.evaluationComplete,
  }, (key, value) => key === 'time' ? undefined : value));
}
export function controller() {
  const result = createReviewController();
  result.requireEvaluation();
  return result;
}
export function response(scope, boundary = 'supported') {
  const records = scope.mode === 'discover'
    ? [{ id: '', sheet: scope.cells[0].sheet, anchors: [scope.cells[0].cell] }]
    : scope.records;
  const proposal = {
    items: records.map(r => ({
      recordId: r.id, sheet: r.sheet, anchors: r.anchors, section: '',
      ambiguous: false, boundaryReason: 'One source occurrence.', fields: [], extras: [],
    })),
    warnings: [],
  };
  const evaluation = { items: proposal.items.map(r => ({
    recordId: r.recordId, sheet: r.sheet, anchors: r.anchors,
    boundary, reason: 'Controlled source check.', fields: [], missing: [],
  })) };
  return { digest: scope.digest, scopeId: scope.scopeId, proposal, evaluation };
}
