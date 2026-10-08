import { identifierHeading, nearestIdentifierHeader } from '../identifier-policy.mjs';
import { normalizeUnit } from '../unit-policy.mjs';
import { sourceLayout, sourceRole } from './source-policy.mjs';
const row = (a) => Number(a.replace(/\D/g, ''));
const plain = (s, a) =>
  s?.cells[a] && !s.cells[a].formula && !s.hiddenRows?.includes(String(row(a)));
const proof = (s, addresses) =>
  JSON.stringify([
    s.name,
    s.hidden,
    addresses.map((a) => [a, s.cells[a], s.hiddenRows?.includes(String(row(a)))]),
  ]);
export function precisionProblem(value) {
  return /^\d+(?:\.\d+)?$/.test(value) &&
    value.replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15
    ? `The stored annual quantity ${value} exceeds Excel’s 15 significant-digit limit. Check the displayed source value, edit to the intended precision, or leave Annual Usage blank. No rounding was applied.`
    : null;
}
export function labeledUnit(record, field, book) {
  const s = book?.sheets.find((s) => s.name === record.sheet),
    n = row(record.anchors[0] || ''),
    a = 'F' + n;
  if (
    !s ||
    s.hidden !== 'visible' ||
    sourceLayout(s)?.kind !== 'tesla' ||
    field.origin === 'ai' ||
    field.evidence.length !== 1 ||
    field.evidence[0] !== a ||
    !['F4', a].every((x) => plain(s, x)) ||
    !/^Unit of Measure$/i.test(s.cells.F4.raw.trim()) ||
    !s.cells[a].raw.trim() ||
    (normalizeUnit(s.cells[a].raw.trim()) || s.cells[a].raw.trim()) !== field.value
  )
    return null;
  return { source: proof(s, ['F4', a]) };
}
/** Recognize explicit packaging expressions without interpreting dimensions or catalog codes. */
function descriptionPackaging(description) {
  const expressions = [];
  const containers =
    'BX|BOX(?:ES)?|BG|BAG(?:S)?|PK|PACK(?:S)?|CA|CS|CASE(?:S)?|PR|PAIR(?:S)?|EA|EACH';
  const contents =
    'PR|PAIR(?:S)?|EA|EACH|PC|PCS|PIECES?|BX|BOX(?:ES)?|BG|BAG(?:S)?|PK|PACK(?:S)?|CS|CASE(?:S)?';
  const relationship = new RegExp(
    `\\b(\\d+)\\s*(?:(${contents})\\s*)?(?:/|per\\s+)\\s*(${containers})\\b`,
    'gi',
  );
  for (const match of description.matchAll(relationship)) {
    expressions.push({
      raw: match[0],
      count: Number(match[1]),
      content: match[2] ? normalizeUnit(match[2]) || match[2].toUpperCase() : null,
      container: normalizeUnit(match[3]) || match[3].toUpperCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  // Compact source shorthand such as 4PK and 100BX. Do not match embedded part numbers.
  for (const match of description.matchAll(/(?<![A-Za-z0-9_-])(\d+)(BX|BG|PK|CS|PR)\b/gi)) {
    if (expressions.some((e) => match.index >= e.start && match.index < e.end)) continue;
    expressions.push({
      raw: match[0],
      count: Number(match[1]),
      content: null,
      container: normalizeUnit(match[2]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return expressions;
}
export function packagingConflict(record, book) {
  const s = book?.sheets.find((s) => s.name === record.sheet),
    n = row(record.anchors[0] || '');
  if (!s || sourceLayout(s)?.kind !== 'tesla') return null;
  const raw = s.cells['G' + n]?.raw?.trim(),
    unit = s.cells['F' + n]?.raw?.trim(),
    description = s.cells['B' + n]?.raw || '';
  if (!/^\d+$/.test(raw || '') || !unit) return null;
  for (const expression of descriptionPackaging(description)) {
    const pairContents = expression.content === 'PR' && /pieces/i.test(s.cells.G4?.raw || '');
    if (
      expression.container !== (normalizeUnit(unit) || unit.toUpperCase()) ||
      expression.count !== Number(raw) ||
      pairContents
    ) {
      return `Conflicting packaging evidence: description says ${expression.raw}; the purchasing-unit column says ${unit} and the count column says ${raw}.${pairContents ? ' The description counts pairs while the table heading says pieces.' : ''} These may describe different packaging levels. Confirm the relationship or leave Qty/UOM blank; no conversion was applied.`;
    }
  }
  return null;
}
export function labeledIdentifier(record, column, field, book) {
  if (
    !['I', 'J'].includes(column) ||
    !field.direct ||
    field.origin === 'ai' ||
    field.evidence.length !== 1
  )
    return null;
  const s = book.sheets.find((s) => s.name === record.sheet),
    a = field.evidence[0];
  if (
    !s ||
    s.hidden !== 'visible' ||
    !plain(s, a) ||
    !record.anchors.some((x) => row(x) === row(a)) ||
    s.cells[a].raw.trim() !== field.value ||
    sourceRole(book, s.name, a) !== 'customer_specification'
  )
    return null;
  const header = nearestIdentifierHeader(s.cells, a);
  if (
    !header ||
    identifierHeading(s.cells[header].raw) !== 'manufacturer' ||
    !plain(s, header) ||
    sourceRole(book, s.name, header) !== 'customer_specification'
  )
    return null;
  return { header, address: a, source: proof(s, [header, a]) };
}
/** Explicit, separate purchasing-unit/count columns. Never infer EA=1, PR=2 or a packaging conversion. */
export function labeledPackCount(record, book) {
  const s = book?.sheets.find((s) => s.name === record.sheet),
    n = row(record.anchors[0] || ''),
    f = record.values.M,
    u = record.values.L;
  if (
    !s ||
    s.hidden !== 'visible' ||
    sourceLayout(s)?.kind !== 'tesla' ||
    !f?.direct ||
    f.origin === 'ai' ||
    f.alternatives?.length ||
    u.alternatives?.length ||
    /conflict|review again|Evaluator requires review/i.test(f.reason + ' ' + u.reason)
  )
    return null;
  const address = 'G' + n,
    unitAddress = 'F' + n,
    description = 'B' + n,
    addresses = ['F4', 'G4', address, unitAddress, description];
  if (
    f.evidence.length !== 1 ||
    f.evidence[0] !== address ||
    !u.evidence.includes(unitAddress) ||
    !addresses.every((a) => plain(s, a) && sourceRole(book, s.name, a) === 'customer_specification')
  )
    return null;
  if (
    !/^Unit of Measure$/i.test(s.cells.F4.raw.trim()) ||
    !/^#\s*(?:of\s+)?Pieces in a UoM$/i.test(s.cells.G4.raw.trim())
  )
    return null;
  const raw = s.cells[address].raw.trim(),
    unitRaw = s.cells[unitAddress].raw.trim();
  if (
    !/^\d+$/.test(raw) ||
    raw !== f.value ||
    Number(raw) < 1 ||
    Number(raw) > 50000 ||
    !unitRaw ||
    (normalizeUnit(unitRaw) || unitRaw) !== u.value
  )
    return null;
  if (packagingConflict(record, book)) return null;
  return {
    address,
    unitAddress,
    header: 'G4',
    count: Number(raw),
    source: proof(s, addresses),
    raw: `${s.cells.G4.raw}: ${raw}; ${s.cells.F4.raw}: ${unitRaw}`,
  };
}
