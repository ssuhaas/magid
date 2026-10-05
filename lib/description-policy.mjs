import { prepareNarrativeUnits } from './unit-policy.mjs';
export function productWording(narrative) {
  const match = /Item\s*#\s*[A-Za-z0-9-]+\s*\(/i.exec(narrative);
  if (!match) return null;
  const first = match.index + match[0].length;
  let depth = 1,
    end = first;
  for (; end < narrative.length; end++) {
    if (narrative[end] === '(') depth++;
    else if (narrative[end] === ')' && !--depth) break;
  }
  return depth === 0 ? narrative.slice(first, end).trim() || null : null;
}
/** Presentation of combined narrative inputs; separate tabular descriptions are preserved. */
export function prepareDescriptions(records, book) {
  for (const r of records) {
    const original = r.values.E;
    if (!original.reason.startsWith('Narrative includes purchasing notes.') || original.origin)
      continue;
    const cells = r.anchors.map((a) => book.sheets.find((s) => s.name === r.sheet)?.cells[a]);
    if (cells.some((c) => !c) || !cells.length) continue;
    const narrative = cells.map((c) => c.raw.trim()).join(' '),
      match = /Item\s*#\s*[A-Za-z0-9-]+\s*\(/i.exec(narrative);
    if (!match) continue;
    const first = match.index + match[0].length;
    let depth = 1,
      end = first;
    for (; end < narrative.length; end++) {
      if (narrative[end] === '(') depth++;
      else if (narrative[end] === ')' && !--depth) break;
    }
    if (depth !== 0 || !narrative.slice(first, end).trim()) continue;
    r.values.F = {
      value: narrative,
      evidence: [...r.anchors],
      reason:
        'Full original item narrative, including its source product code and ordering instructions. Wrapped source cells are joined in their original order; no facts are added.',
      status: 'pending',
      origin: 'source_narrative',
      direct: cells.length === 1,
    };
    r.values.E = {
      value: narrative.slice(first, end).trim(),
      evidence: [...r.anchors],
      reason:
        'Product wording isolated from the first balanced parenthesis after the item code. The full original narrative is preserved in Description 2. Brand, size and specifications stay in this product wording even when also populated in dedicated fields.',
      status: 'pending',
      origin: 'narrative_product',
      direct: false,
    };
  }
  return prepareNarrativeUnits(records, book);
}
