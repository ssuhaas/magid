import { randomUUID } from 'node:crypto';
import { buildScope } from './src/ai/client.mjs';
import { sourceLayout, sourceRole, isSourceHeader, isDiscountContext } from './src/canonical/source-policy.mjs';

const rowOf = a => Number(a.replace(/\D/g, ''));
const columnOf = a => a.replace(/\d+$/, '');
const keyOf = (sheet, cell) => JSON.stringify([sheet, cell]);
const heading = /^(?:Item|Part #|Item Description|Manufacturer Name|Manufacturer Part Number|Unit of Measure|# of Pieces in a UoM|Annual Volume|Annual Usage|\d+\.\s*Grainger Items)$/i;

/** Only established item links and narrowly recognized context can bypass discovery. */
export function unaccountedCells(book, records) {
  const linked = new Set();
  for (const record of records) {
    if (record.ambiguous)
      throw Error(`Unresolved product group at ${record.sheet}!${record.anchors.join(', ')}. Resolve its item boundaries before normalization.`);
    for (const a of [...record.anchors, ...Object.values(record.values).flatMap(f => f.evidence),
      ...Object.values(record.extras).flatMap(f => f.evidence)]) linked.add(keyOf(record.sheet, a));
  }
  const missing = new Map();
  for (const sheet of book.sheets) {
    const layout = sourceLayout(sheet);
    const itemRows = new Set(records.filter(r => r.sheet === sheet.name).flatMap(r => r.anchors.map(rowOf)));
    const pending = [];
    for (const [a, cell] of Object.entries(sheet.cells)) {
      if (!cell.raw.trim() && !cell.formula) continue;
      // Hidden source is still inventoried. It cannot be silently treated as irrelevant.
      if (sheet.hidden !== 'visible' || sheet.hiddenRows?.includes(String(rowOf(a))))
        throw Error(`Unresolved hidden source at ${sheet.name}!${a}. Unhide or remove irrelevant source before normalization.`);
      if ((cell.raw.match(/Item\s*#/gi) || []).length > 1)
        throw Error(`Multiple product occurrences in ${sheet.name}!${a}; item boundaries must be resolved.`);
      if (linked.has(keyOf(sheet.name, a))) continue;
      if (!cell.formula && heading.test(cell.raw.trim())) continue;
      if (!cell.formula && /^\s*[.\-]?\s*KEEP AN EYE ON YOUR CURRENT STOCK\s*$/i.test(cell.raw)) continue;
      // Quote columns are separate from customer requirements in this verified table.
      if (layout?.kind === 'tesla' && itemRows.has(rowOf(a)) &&
          !/Item\s*#|^\s*Product:/i.test(cell.raw) &&
          sourceRole(book, sheet.name, a) !== 'customer_specification') continue;
      // Only the known single-table source columns can be adjacent item attributes.
      const columns = layout?.kind === 'tesla' ? 'ACDFGHI' :
        layout?.kind === 'daikin' ? 'ABCEFGHIJ' : layout?.kind === 'hyundai' ? 'ABDEFG' : '';
      if (itemRows.has(rowOf(a)) && columns.includes(columnOf(a)) && columnOf(a).length === 1 &&
          !/Item\s*#|^\s*Product:/i.test(cell.raw)) continue;
      pending.push(a);
    }
    if (pending.length) missing.set(sheet.name, pending);
  }
  return missing;
}

/** Unknown contiguous blocks stay intact; don't bisect an unrecognized wrapped item. */
export function planRecovery(book, records, digest) {
  const scopes = [];
  for (const [name, pending] of unaccountedCells(book, records)) {
    const sheet = book.sheets.find(s => s.name === name);
    const rows = [...new Set(pending.map(rowOf))].sort((a, b) => a - b);
    const groups = [];
    for (const row of rows) {
      const last = groups.at(-1);
      if (!last || row !== last.at(-1) + 1) groups.push([row]);
      else last.push(row);
    }
    for (const group of groups) {
      if (group.at(-1) - group[0] > 100)
        throw Error(`Unresolved long source block at ${name}!rows ${group[0]}–${group.at(-1)}. Resolve layout boundaries before normalization.`);
      const wanted = new Set(pending.filter(a => group.includes(rowOf(a))));
      let scope;
      try {
        scope = buildScope(book, [], { mode: 'discover', digest, scopeId: randomUUID(),
          sheet: name, start: group[0], end: group.at(-1) });
      } catch {
        throw Error(`Source coverage region too large at ${name}!rows ${group[0]}–${group.at(-1)}. Resolve layout boundaries before export.`);
      }
      // Existing occurrences and headers remain available as context, never duplicate anchors.
      for (const cell of scope.cells) cell.eligibleAnchor = wanted.has(cell.cell);
      scopes.push(scope);
    }
  }
  return scopes;
}

export function assertRecoveredItems(records, projected) {
  for (let i = 0; i < records.length; i++) {
    const r = projected[i];
    if (!r.values.E.value && !r.values.F.value &&
        !Object.entries(r.extras).some(([name, f]) => /source.*(?:product|code)/i.test(name) && f.value))
      throw Error(`No usable product description or identifier for ${records[i].sheet}!${records[i].anchors.join(', ')}. No workbook was exported.`);
  }
}

/** Known item-bearing columns are obligations, not optional model classifications. */
export function assertProductAnchors(book, scope, proposal) {
  const anchors = new Set(proposal.items.flatMap(item => item.anchors.map(a => keyOf(item.sheet, a))));
  for (const cell of scope.cells.filter(c => c.eligibleAnchor)) {
    const sheet = book.sheets.find(s => s.name === cell.sheet), layout = sourceLayout(sheet);
    const knownItem = layout && !isDiscountContext(sheet, cell.cell) && rowOf(cell.cell) >= layout.start && !isSourceHeader(sheet, cell.cell) &&
      (layout.description === columnOf(cell.cell) || layout.lanes?.includes(columnOf(cell.cell)));
    if ((knownItem || /Item\s*#|^\s*Product:/i.test(cell.raw)) &&
        !heading.test(cell.raw.trim()) && !anchors.has(keyOf(cell.sheet, cell.cell)))
      throw Error(`Missing product occurrence at ${cell.sheet}!${cell.cell}. No workbook was exported.`);
  }
}
