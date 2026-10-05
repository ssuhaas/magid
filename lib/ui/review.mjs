import { hasMatchingIdentity } from '../canonical/identity.mjs';
import { currentCoverage, cellKey } from '../canonical/coverage.mjs';
export const labels = {
  B: 'Bid line number',
  C: 'Customer reference',
  D: 'Product category',
  E: 'Description 1 — product wording',
  F: 'Description 2 — full narrative or additional source text',
  G: 'Size',
  H: 'Manufacturer',
  I: 'Manufacturer part number',
  J: 'Second manufacturer part number',
  K: 'Annual usage',
  L: 'Unit of measure',
  M: 'Quantity per unit',
};
// The preview and commit use the same eligibility rules.
export function batchFields(item, action, book) {
  if (item.boundary === 'exclude') return [];
  const pending = (f) => f?.status === 'pending';
  if (action === 'boundaries')
    return !item.ambiguous && item.boundary !== 'include' ? [['boundary', null]] : [];
  if (action === 'direct')
    return Object.entries(item.values).filter(
      ([, f]) =>
        pending(f) &&
        f.direct &&
        f.value !== '' &&
        !f.alternatives?.length &&
        !f.evidence.some((a) => book?.sheets.find((s) => s.name === item.sheet)?.cells[a]?.formula),
    );
  const extra = action.startsWith('extra:'),
    key = action.slice(action.indexOf(':') + 1),
    field = extra ? item.extras[key] : item.values[key];
  return pending(field) && (!extra || !field.alternatives?.length) ? [[key, field]] : [];
}
/** Fields that contribute to review: base fields plus reviewer-approved columns. */
function reviewFields(item, columns) {
  return [
    ...Object.values(item.values),
    ...Object.entries(item.extras)
      .filter(([name]) => columns[name] === 'approved')
      .map(([, field]) => field),
  ];
}

function requiresReview(item, columns, book, fields) {
  return (
    item.boundary === 'pending' ||
    (item.boundary !== 'exclude' &&
      (!hasMatchingIdentity(item, columns, book) ||
        fields.some((field) => field.status === 'pending')))
  );
}

/** @param {any} item @param {Record<string,string>} columns @param {any} book */
export function needsReview(item, columns = {}, book = null) {
  // Excluded and unresolved boundaries do not need field or identity inspection.
  if (item.boundary === 'exclude') return false;
  if (item.boundary === 'pending') return true;
  return requiresReview(item, columns, book, reviewFields(item, columns));
}
export function reviewGroups(index, controller, sheet) {
  const source = index.sheets.get(sheet);
  if (!source) return [];
  const cells = Object.keys(source.cells)
    .filter((a) => !currentCoverage(controller, index, sheet, a))
    .sort(
      (a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b),
    );
  const groups = [];
  for (const a of cells) {
    const row = Number(a.replace(/\D/g, '')),
      linked = (index.links.get(cellKey(sheet, a)) || []).some((r) => r.boundary === 'include'),
      last = groups.at(-1);
    if (!last || last.linked !== linked || last.addresses.length >= 100 || row > last.end + 1)
      groups.push({ sheet, linked, start: row, end: row, addresses: [a] });
    else {
      last.addresses.push(a);
      last.end = row;
    }
  }
  return groups;
}
export function spreadsheetWindow(sheet, focus) {
  const match = /^([A-Z]+)(\d+)$/.exec(focus || 'A1') || ['', 'A', '1'],
    column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
    row = Number(match[2]);
  let maxRow = row;
  for (const a of Object.keys(sheet.cells)) maxRow = Math.max(maxRow, Number(a.replace(/\D/g, '')));
  return {
    rows: [...new Set([1, 2, 3, ...Array.from({ length: 9 }, (_, i) => row - 4 + i)])]
      .filter((n) => n > 0 && n <= maxRow)
      .sort((a, b) => a - b),
    startColumn: Math.max(1, column - 3),
    endColumn: Math.max(8, column + 3),
  };
}
const AUTOMATIC_STATUSES = new Set(['auto_accepted', 'auto_evaluated', 'auto_blank']);

/** One current-state summary for every review counter. Totals are never pending counts.
 * @param {any[]} items @param {Record<string,string>} columns @param {any} controller @param {any} book */
export function reviewStats(items, columns = {}, controller = null, book = null) {
  const summary = {
    total: items.length,
    included: 0,
    excluded: 0,
    reviewed: 0,
    pendingItems: 0,
    pendingFields: 0,
    totalFields: 0,
    handledFields: 0,
    pendingBoundaries: 0,
    automaticItems: 0,
    pendingColumns: Object.values(columns).filter((status) => status === 'pending').length,
  };

  // Inspect each active record once. All badges still share the same readiness rules.
  for (const item of items) {
    if (item.boundary === 'exclude') {
      summary.excluded++;
      continue;
    }
    const fields = reviewFields(item, columns);
    const pending = requiresReview(item, columns, book, fields);
    summary.totalFields += fields.length;
    summary.pendingFields += fields.filter((field) => field.status === 'pending').length;
    if (pending) summary.pendingItems++;
    if (item.boundary === 'pending') summary.pendingBoundaries++;
    if (item.boundary !== 'include') continue;

    summary.included++;
    if (pending) continue;
    summary.reviewed++;
    const systemBoundary = !controller || controller.boundaries.get(item.id)?.system;
    if (systemBoundary && fields.every((field) => AUTOMATIC_STATUSES.has(field.status))) {
      summary.automaticItems++;
    }
  }
  summary.handledFields = summary.totalFields - summary.pendingFields;
  return summary;
}
