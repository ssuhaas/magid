import { randomUUID } from 'node:crypto';
import { rawItems } from './src/ai/item-discovery.mjs';
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

/** Bound source requests while preserving every target cell, including hidden source. */
export function planRecovery(book, records, digest) {
  const scopes = [];
  for (const [name, pending] of unaccountedCells(book, records)) {
    const sheet = book.sheets.find(s => s.name === name);
    const rows = [...new Set(pending.map(rowOf))].sort((a, b) => a - b);
    const build = group => {
      const rowSet = new Set(group);
      const wanted = new Set(pending.filter(a => rowSet.has(rowOf(a))));
      try {
        if (group.at(-1) - group[0] > 79 || wanted.size > 80) throw Error('Split source region.');
        const scope = buildScope(book, [], { mode: 'discover', digest, scopeId: randomUUID(),
          sheet: name, start: group[0], end: group.at(-1) });
        for (const cell of scope.cells) cell.eligibleAnchor = wanted.has(cell.cell);
        scopes.push(scope);
      } catch (error) {
        if (group.length > 1) {
          const middle = Math.floor(group.length / 2);
          build(group.slice(0, middle)); build(group.slice(middle));
        } else {
          // Even oversized headers cannot prevent retaining a source row. Use bounded
          // raw-cell scopes; unsupported namespace-dependent fields remain blank.
          let cells = [];
          const flush = () => {
            if (cells.length) scopes.push({ mode: 'discover', digest, scopeId: randomUUID(), cells, records: [] });
            cells = [];
          };
          for (const address of wanted) {
            const c = sheet.cells[address];
            const cell = { sheet: name, cell: address, raw: c.raw, formula: c.formula,
              eligibleAnchor: true, contextRole: 'item' };
            if (cells.length && new TextEncoder().encode(JSON.stringify([...cells, cell])).length > 250000) flush();
            cells.push(cell);
            if (cells.length === 50) flush();
          }
          flush();
        }
      }
    };
    if (rows.length) build(rows);
  }
  return scopes;
}

/** Keep raw text in description 2 when normalization cannot supply a matching key. */
export function preserveRawItems(original, projected, book) {
  for (let i = 0; i < original.length; i++) {
    const record = projected.records[i];
    if (record.values.F.value || (!original[i].ambiguous && (record.values.E.value ||
        Object.entries(record.extras).some(([name, f]) => /source.*(?:product|code)/i.test(name) && f.value)))) continue;
    const sheet = book.sheets.find(s => s.name === original[i].sheet);
    const text = original[i].anchors.map(a => sheet.cells[a]?.raw ||
      (sheet.cells[a]?.formula ? 'Formula (not evaluated): ' + sheet.cells[a].formula : '')).filter(Boolean).join(' | ');
    if (text) {
      // Source text is copied literally, even from hidden rows. It is not a verified
      // size, annual quantity or manufacturer identity. Formula expressions never run.
      record.values.F.value = text;
      record.values.F.evidence = [...original[i].anchors];
      const name = 'Original Source Cells';
      record.extras[name] = { ...record.values.F,
        value: original[i].sheet + '!' + original[i].anchors.join(', '), evidence: [...original[i].anchors] };
      projected.columns[name] = 'approved';
    }
  }
}

/** Known item-bearing columns are obligations, not optional model classifications. */
export function preserveProductAnchors(book, scope, proposal, identified = []) {
  const unresolvedSources = new Set(identified.filter(r => r.ambiguous || r.extras['Additional Source Code']?.value)
    .flatMap(r => [...r.anchors, ...(r.extras['Additional Source Code']?.evidence || [])]
      .map(a => keyOf(r.sheet, a))));
  const anchors = new Set(proposal.items.flatMap(item => item.anchors.map(a => keyOf(item.sheet, a))));
  const missing = [];
  for (const cell of scope.cells.filter(c => c.eligibleAnchor)) {
    const sheet = book.sheets.find(s => s.name === cell.sheet), layout = sourceLayout(sheet);
    const knownItem = layout && !isDiscountContext(sheet, cell.cell) && rowOf(cell.cell) >= layout.start && !isSourceHeader(sheet, cell.cell) &&
      (layout.description === columnOf(cell.cell) || layout.lanes?.includes(columnOf(cell.cell)));
    if ((knownItem || unresolvedSources.has(keyOf(cell.sheet, cell.cell)) || /Item\s*#|^\s*Product:/i.test(cell.raw)) &&
        !heading.test(cell.raw.trim()) && !anchors.has(keyOf(cell.sheet, cell.cell)))
      missing.push(cell);
  }
  proposal.items.push(...rawItems(missing));
}
