import { identifierLoss } from '../identifier-retention.mjs';
import { boundaryRule, sourceDecision, evaluationEligible } from './source-policy.mjs';
import {
  coverageIndex,
  currentCoverage,
  cellSignature,
  layoutSignature,
  coverageStats,
  checkCoverage,
} from './coverage.mjs';
const key = (...p) => JSON.stringify(p);
/** No human decisions are fabricated. All automatic stamps are session policy records. */
export function automateBoundaries(controller, records, book) {
  for (const r of records) {
    const prior = controller.boundaries.get(r.id);
    if (prior && !prior.system) continue;
    const rule = boundaryRule(r, book);
    if (r.boundary === 'pending' && r.evaluationBoundaryReview) continue;
    if (rule && ['pending', 'include'].includes(r.boundary)) {
      r.boundary = 'include';
      r.boundaryReason = rule.reason;
      const signature = key(r.sheet, r.anchors, r.boundary);
      if (prior?.signature !== signature || prior.source !== rule.source)
        controller.boundaries.set(r.id, {
          ...controller.ruleEvent(rule.reason),
          system: true,
          ...rule,
          signature,
        });
    } else if (prior?.system) {
      controller.boundaries.delete(r.id);
      r.boundary = 'pending';
    }
  }
  return records;
}
export function automateCoverage(controller, book, records, columns = {}) {
  const index = coverageIndex(book, records, controller),
    formulaRecords = records.filter((r) =>
      controller.formulaVerified(r, book, r.values.K.evidence[0]),
    );
  for (const s of book.sheets)
    for (const a of Object.keys(s.cells)) {
      const old = currentCoverage(controller, index, s.name, a);
      if (old) continue;
      const verified = formulaRecords.filter(
        (r) => r.sheet === s.name && r.values.K.evidence[0] === a,
      );
      const decision = verified.length
        ? {
            disposition: 'item',
            role: 'customer_specification',
            itemIds: verified.map((r) => r.id),
            reason:
              'Reviewer confirmed an independently checked constant formula and its annual purchasing unit.',
          }
        : sourceDecision(index, s.name, a);
      if (decision)
        controller.coverage.set(key(s.name, a), {
          ...controller.ruleEvent(decision.reason),
          system: true,
          rule: 'source-coverage-v2',
          signature: cellSignature(index, s.name, a),
          ...decision,
        });
    }
  for (const s of book.sheets) {
    const stats = coverageStats(controller, index).sheets.find((x) => x.sheet === s.name);
    if (stats.unresolved) continue;
    const sig = layoutSignature(controller, index, s.name),
      old = controller.layouts.get(s.name);
    if (old?.signature === sig) continue;
    controller.layouts.set(s.name, {
      ...controller.ruleEvent(
        'All original cells are accounted for by source rules or explicit reviewer decisions.',
      ),
      system: true,
      rule: 'source-layout-v2',
      signature: sig,
    });
  }
  return { index, complete: checkCoverage(controller, index, columns).length === 0 };
}
export function applyEvaluationFindings(records, evaluations, controller) {
  for (const verdict of evaluations.flatMap((e) => e.items)) {
    const r = records.find(
      (r) =>
        (r.id === verdict.recordId || !verdict.recordId) &&
        r.sheet === verdict.sheet &&
        key(r.anchors) === key(verdict.anchors),
    );
    if (!r) continue;
    if (
      verdict.boundary === 'review' &&
      (!controller?.boundaries.get(r.id) || controller.boundaries.get(r.id).system)
    ) {
      r.evaluationBoundaryReview = true;
      r.boundary = 'pending';
      r.boundaryReason = 'Evaluator flagged this boundary: ' + verdict.reason;
    }
    for (const finding of verdict.fields) {
      const f = r.values[finding.column];
      if (
        !['pending', 'auto_accepted', 'auto_blank'].includes(f.status) ||
        f.value !== finding.value
      )
        continue;
      if (finding.verdict !== 'supported' && f.value) {
        f.status = 'pending';
        f.reason += ' Evaluator requires review: ' + finding.reason;
      }
    }
    for (const missing of verdict.missing) {
      if (
        missing.evidence.length &&
        missing.evidence.every((e) =>
          Object.values(r.extras).some(
            (f) =>
              f.evidence.includes(e.cell) &&
              f.value.split(/\s*\|\s*/).some((v) => v.trim() === e.quote.trim()),
          ),
        )
      )
        continue;
      const f = r.values[missing.column];
      if (['accepted', 'edited', 'blank'].includes(f.status)) continue;
      f.status = 'pending';
      f.reason = 'Evaluator found potentially missing information: ' + missing.reason;
      f.evidence = [...new Set([...f.evidence, ...missing.evidence.map((e) => e.cell)])];
    }
  }
  return records;
}
export function pruneRedundantExtras(records, columns = {}) {
  for (const r of records) {
    const supplied = r.extras['Source Product ID'];
    if (
      supplied &&
      !['approved', 'declined'].includes(columns['Source Product ID']) &&
      identifierLoss([r], {}).length === 0
    ) {
      r.sourceProductID = structuredClone(supplied);
      delete r.extras['Source Product ID'];
    }
    for (const [name, f] of Object.entries(r.extras))
      if (
        !['approved', 'declined'].includes(columns[name]) &&
        /order(?:ing)?|purchasing.*notes/i.test(name) &&
        f.value.trim().length > 0 &&
        r.values.F.origin === 'source_narrative' &&
        r.values.F.value.replace(/\s+/g, ' ').includes(f.value.replace(/\s+/g, ' '))
      )
        delete r.extras[name];
  }
  return records;
}
export { evaluationEligible };
