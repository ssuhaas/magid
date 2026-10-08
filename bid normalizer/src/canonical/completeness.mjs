// @ts-check
import { automaticRule, automaticExtraRule } from './automatic.mjs';
import { boundaryRule, sourceLayout } from './source-policy.mjs';
import { fieldContracts } from './field-contracts.mjs';

// Closed vocabulary of plain product families, not a taxonomy or brand/size guess.
// A category outside this grammar goes to AI even when copied successfully.
const plainFamily = /^(?:Goggles|Safety Glasses|Ear Plugs|Ear Muffs|Sleeves|Hard Hats|Batteries|Hair Nets|(?:Propane|Purge|Electrical|Cut|Chemical|Cotton|Linefeeder|Nitrile) Gloves)$/i;
const columns = Object.entries(fieldContracts).filter(([, c]) => c.canonical).map(([c]) => c);

/**
 * Reproducible absence proof for a closed, recognized stock-code lane. Ordinary
 * auto_blank, reviewer status, and AI agreement are never completeness evidence.
 * More layouts can qualify only after adding an independently tested source rule.
 * @param {import('../review-types').Item} record
 * @param {import('../review-types').Book} book
 */
export function deterministicCompleteness(record, book) {
  if (record.boundary !== 'include' || record.ambiguous || record.evaluationBoundaryReview ||
      record.anchors.length !== 1 || !boundaryRule(record, book)) return null;
  const sheet = book.sheets.find((s) => s.name === record.sheet);
  const layout = sheet && sourceLayout(sheet);
  if (!sheet || layout?.kind !== 'berry' ||
      layout.proof.some((a) => sheet.cells[a]?.formula != null ||
        sheet.hiddenRows?.includes(a.replace(/\D/g, '')))) return null;
  const anchor = record.anchors[0];
  const lane = { B: ['A', 'B', 'C'], E: ['D', 'E', 'F'], H: ['G', 'H', 'I'] }[anchor.replace(/\d+$/, '')];
  if (!lane) return null;
  if (sheet.cells[lane[0] + '1']?.raw !== 'Item' ||
      sheet.cells[lane[0] + '1']?.formula != null ||
      lane.some((c) => sheet.cells[c + '2']?.raw.trim() || sheet.cells[c + '2']?.formula != null))
    return null;
  const n = anchor.replace(/\D/g, '');
  const code = record.extras['Source Product ID'];
  if (Object.keys(record.extras).length !== 1 || !code || !automaticExtraRule(record, code, book) ||
      code.evidence.length !== 1 || code.evidence[0] !== anchor ||
      !/^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._#/-]*$/.test(code.value) ||
      sheet.cells[anchor]?.raw.trim() !== code.value) return null;
  // Either adjacent cell might carry a description, quantity or another code.
  // Even an empty formula or hidden cell must prevent skipping.
  for (const col of lane.filter((c) => c !== lane[1])) {
    const cell = sheet.cells[col + n];
    if (cell && (cell.raw.trim() || cell.formula != null)) return null;
  }
  if (Object.keys(record.values).length !== columns.length) return null;
  for (const column of columns) {
    const field = record.values[column];
    const rule = automaticRule(record, column, field, book);
    if (!rule || field?.packReview) return null;
    if (column === 'D' && field.value) {
      if (rule.status !== 'auto_accepted' || !plainFamily.test(field.value) ||
          field.evidence.length !== 1 || field.evidence[0].replace(/\d+$/, '') !== lane[0] ||
          Number(field.evidence[0].replace(/\D/g, '')) >= Number(n)) return null;
      const categoryRow = field.evidence[0].replace(/\D/g, '');
      if (lane.slice(1).some((c) => sheet.cells[c + categoryRow]?.raw.trim() ||
          sheet.cells[c + categoryRow]?.formula != null)) return null;
    } else if (field.value || rule.status !== 'auto_blank' || field.evidence.length) return null;
  }
  return {
    rule: 'closed-stock-lane-v1',
    reason: 'Only one literal stock code and an optional plain product family are present in this recognized lane. No description, size, manufacturer, usage or packaging fact is available to extract.',
  };
}

/** Recheck before granting run completion; cached IDs are never proofs.
 * @param {import('../review-types').Item[]} baseline
 * @param {import('../review-types').Item[]} proposed
 * @param {import('../review-types').Book} book
 * @param {string[]} skippedIds
 */
export function verifyDeterministicSkips(baseline, proposed, book, skippedIds) {
  if (new Set(skippedIds).size !== skippedIds.length) throw Error('Duplicate deterministic skip.');
  for (const id of skippedIds) {
    const before = baseline.filter((r) => r.id === id);
    const after = proposed.filter((r) => r.id === id);
    if (before.length !== 1 || after.length !== 1 ||
        JSON.stringify(before[0]) !== JSON.stringify(after[0]) ||
        !deterministicCompleteness(before[0], book))
      throw Error('Deterministic completeness changed; process this row again.');
  }
}
