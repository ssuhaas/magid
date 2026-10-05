/** Normalize only complete known unit names; composite and unfamiliar units stay unresolved. */
const aliases = {
  pair: 'PR',
  pairs: 'PR',
  pr: 'PR',
  each: 'EA',
  ea: 'EA',
  box: 'BX',
  boxes: 'BX',
  bx: 'BX',
  bag: 'BG',
  bags: 'BG',
  bg: 'BG',
  dozen: 'DZ',
  dozens: 'DZ',
  dz: 'DZ',
  case: 'CS',
  cases: 'CS',
  cs: 'CS',
  pack: 'PK',
  packs: 'PK',
  pk: 'PK',
  roll: 'RL',
  rolls: 'RL',
  rl: 'RL',
  bt: 'BT',
  bottle: 'BT',
  bottles: 'BT',
};
export function normalizeUnit(raw) {
  return aliases[String(raw).trim().toLowerCase()] || null;
}
/** An explicit ordering clause is purchasing-unit evidence, never a pack count or annual volume. */
export function purchasingUnit(text) {
  if (/\b(?:do\s+not|never)\s+order\b/i.test(text)) return null;
  const clauses = String(text).match(/\bOrder\b[^.!\n]*/gi) || [];
  const found = [];
  for (const clause of clauses) {
    if (/\b(?:not|instead|except|no)\b/i.test(clause)) return null;
    const matches = [
      ...clause.matchAll(
        /\b(?:\d+(?:\s*(?:or|to|-)\s*\d+)*|a few|a|an|one)\s+(boxes|bags|pairs|cases|packs|rolls|dozens|bottles|box|bag|pair|case|pack|roll|dozen|bottle|each)\b/gi,
      ),
    ];
    const tokens = [
      ...clause.matchAll(
        /\b(boxes|bags|pairs|cases|packs|rolls|dozens|bottles|box|bag|pair|case|pack|roll|dozen|bottle|each)\b/gi,
      ),
    ];
    if (tokens.length !== matches.length) return null;
    for (const m of matches) found.push(normalizeUnit(m[1]));
  }
  return found.length && new Set(found).size === 1 ? found[0] : null;
}
export function supportsUnit(text, value) {
  return (
    normalizeUnit(text) === (normalizeUnit(value) || value) ||
    purchasingUnit(text) === (normalizeUnit(value) || value)
  );
}
export function prepareNarrativeUnits(records, book) {
  for (const r of records) {
    if (r.values.F.origin !== 'source_narrative') continue;
    const field = r.values.L;
    if (
      !['pending', 'auto_blank', 'auto_accepted'].includes(field.status) ||
      field.alternatives?.length
    )
      continue;
    const sheet = book.sheets.find((s) => s.name === r.sheet),
      cells = r.anchors.map((a) => sheet?.cells[a]);
    if (!cells.length || cells.some((c) => !c)) continue;
    const unit = purchasingUnit(cells.map((c) => c.raw.trim()).join(' '));
    if (!unit || (field.value && normalizeUnit(field.value) !== unit)) continue;
    if (field.origin === 'narrative_uom' && field.value === unit) continue;
    r.values.L = {
      value: unit,
      evidence: [...r.anchors],
      reason:
        'Purchasing unit explicitly stated in the original ordering instructions. Only the unit name is normalized; no quantity, pack count or annual usage is inferred.',
      status: 'pending',
      origin: 'narrative_uom',
      direct: false,
    };
  }
  return records;
}
