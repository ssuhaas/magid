import { automaticRule, automaticExtraRule } from './src/canonical/automatic.mjs';
import { sourceRole, sourceLayout } from './src/canonical/source-policy.mjs';
import { precisionProblem, packagingConflict } from './src/canonical/source-facts.mjs';

function customerSource(record, address, book) {
  if (sourceRole(book, record.sheet, address) === 'customer_specification') return true;
  const sheet = book.sheets.find(s => s.name === record.sheet);
  const row = Number(address.replace(/\D/g, '')), column = address.replace(/\d+$/, '');
  // A separately labeled table can live past the original supplier quote columns.
  // Unlabeled quote data remains protected, even when AI suggests a product.
  if (!record.boundaryReason.startsWith('AI boundary candidate:') ||
      sourceLayout(sheet)?.kind !== 'tesla' || sheet.cells['B' + row]?.raw.trim()) return false;
  for (let n = row - 1; n >= Math.max(1, row - 100); n--) {
    const header = sheet.cells[column + n];
    if (header?.raw.trim()) return !header.formula && !sheet.hiddenRows?.includes(String(n)) &&
      /^(?:Item Description|Product Description)$/i.test(header.raw.trim());
  }
  return false;
}

function sourceSafe(record, field, book) {
  const sheet = book.sheets.find(s => s.name === record.sheet);
  return !!sheet && sheet.hidden === 'visible' && field.evidence.length > 0 &&
    !field.alternatives?.length && field.evidence.every(a => sheet.cells[a] &&
      sheet.cells[a].formula == null && !sheet.hiddenRows?.includes(a.replace(/\D/g, '')) &&
      customerSource(record, a, book));
}

/** Projection is automatic policy, never a fabricated human/controller approval.
 * The workbook is an intermediate pipeline artifact; evaluation is external.
 */
export function projectWorkbookRecords(input, book) {
  const records = structuredClone(input), columns = {};
  for (const record of records) {
    record.boundary = 'include';
    const sheet = book.sheets.find(s => s.name === record.sheet);
    for (const [column, field] of Object.entries(record.values)) {
      if (!field.value) continue;
      const rule = automaticRule(record, column, field, book);
      const supported = sourceSafe(record, field, book) &&
        (field.origin === 'ai' || rule?.status === 'auto_accepted' ||
          (field.direct && field.evidence.some(a => sheet.cells[a].raw === field.value ||
            sheet.cells[a].raw.trim() === field.value)));
      const invalidNumber = ['K', 'M'].includes(column) &&
        (!/^\d+(\.\d+)?$/.test(field.value) || !Number.isFinite(Number(field.value)) ||
          precisionProblem(field.value) || (column === 'M' &&
            (!Number.isInteger(Number(field.value)) || Number(field.value) < 1 || Number(field.value) > 50000)));
      // Deterministic annual/identifier meaning must be proven by the source rule.
      const invalidMeaning = ['K', 'I', 'J'].includes(column) && field.origin !== 'ai' &&
        rule?.status !== 'auto_accepted';
      if (!supported || invalidNumber || invalidMeaning ||
          (column === 'M' && packagingConflict(record, book))) field.value = '';
    }
    for (const [name, field] of Object.entries(record.extras)) {
      if (!field.value || !sourceSafe(record, field, book) ||
          (field.origin !== 'ai' && !automaticExtraRule(record, field, book))) {
        delete record.extras[name];
        continue;
      }
      columns[name] = 'approved'; // Writer selection only; no reviewer stamp is minted.
    }
    for (const field of [...Object.values(record.values), ...Object.values(record.extras)])
      if (field.value.length > 32767) throw Error('Excel cell text exceeds 32,767 characters.');
  }
  return { records, columns };
}
