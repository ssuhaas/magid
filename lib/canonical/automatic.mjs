import { labeledIdentifier, labeledPackCount, labeledUnit } from './source-facts.mjs';
import { sourceDate } from '../date-policy.mjs';
import { normalizeUnit, purchasingUnit } from '../unit-policy.mjs';
import { productWording } from '../description-policy.mjs';
import { sourceRole, sourceLayout, isSourceHeader } from './source-policy.mjs';
/** Source-only session rules. Semantic interpretations require a separate evaluated proof. */
export function automaticRule(record, column, field, book) {
  if (
    !field ||
    /Evaluator requires review|potentially missing|conflict|routing instructions/i.test(
      field.reason,
    ) ||
    !['pending', 'auto_blank', 'auto_accepted'].includes(field.status) ||
    field.alternatives?.length
  )
    return null;
  const sheet = book.sheets.find((s) => s.name === record.sheet);
  if (
    !sheet ||
    sheet.hidden !== 'visible' ||
    field.evidence.some((a) => sheet.hiddenRows?.includes(a.replace(/\D/g, '')))
  )
    return null;
  const cells = field.evidence.map((a) => sheet.cells[a]);
  if (
    cells.some((c) => !c || (c.formula !== null && c.formula !== undefined)) ||
    field.evidence.some((a) => sourceRole(book, record.sheet, a) !== 'customer_specification')
  )
    return null;
  if (!field.value && cells.every((c) => !c.raw))
    return {
      status: 'auto_blank',
      rule: 'absence-v1',
      reason:
        'No supported value was extracted from this proposal. The output is blank; no value was inferred.',
    };
  if (
    column === 'L' &&
    field.origin !== 'ai' &&
    cells.length &&
    field.evidence.every((a) =>
      record.anchors.some((anchor) => a.replace(/\D/g, '') === anchor.replace(/\D/g, '')),
    ) &&
    ((cells.length === 1 && normalizeUnit(cells[0].raw) === field.value) ||
      (field.origin === 'narrative_uom' &&
        purchasingUnit(cells.map((c) => c.raw.trim()).join(' ')) === field.value))
  )
    return {
      status: 'auto_accepted',
      rule: 'unit-alias-v1',
      reason:
        'Purchasing unit verified against the cited source and normalized to a standard unit code. No pack count or annual quantity inferred.',
    };
  const unit = column === 'L' && labeledUnit(record, field, book);
  if (unit)
    return {
      status: 'auto_accepted',
      rule: 'labeled-unit-v1',
      source: unit.source,
      reason:
        'Purchasing unit copied from the explicitly labeled source column. Known aliases are normalized; unfamiliar codes such as CA and LVP stay as supplied.',
    };
  const identifier = labeledIdentifier(record, column, field, book);
  if (identifier)
    return {
      status: 'auto_accepted',
      rule: 'labeled-identifier-v1',
      source: identifier.source,
      reason: `Manufacturer identifier copied exactly from ${identifier.address}, under the explicit manufacturer identifier header ${identifier.header}; surrounding whitespace trimmed, no catalog identity inferred.`,
    };
  const count = column === 'M' && labeledPackCount(record, book);
  if (count)
    return {
      status: 'auto_accepted',
      rule: 'labeled-pack-v1',
      source: count.source,
      reason: `Exact count from ${count.address}, under the quantity-per-purchasing-unit header ${count.header}, checked against ${count.unitAddress} and the description. No unit conversion or default count inferred.`,
    };
  const layout = sourceLayout(sheet),
    n = Number(record.anchors[0]?.replace(/\D/g, '')),
    annualAddress =
      layout?.kind === 'hyundai' ? 'E' + n : layout?.kind === 'tesla' ? 'I' + n : null,
    annualHeader =
      layout?.kind === 'hyundai'
        ? 'E' + (n >= 27 ? 26 : 17)
        : layout?.kind === 'tesla'
          ? 'I4'
          : null;
  if (
    column === 'K' &&
    field.origin !== 'ai' &&
    field.direct &&
    cells.length === 1 &&
    field.evidence[0] === annualAddress &&
    isSourceHeader(sheet, annualHeader) &&
    !sheet.cells[annualHeader]?.formula &&
    !sheet.hiddenRows?.includes(annualHeader.replace(/\D/g, '')) &&
    /annual|yearly|per year/i.test(sheet.cells[annualHeader]?.raw || '') &&
    cells[0].raw.trim() === field.value &&
    /^\d+(\.\d+)?$/.test(field.value) &&
    field.value.replace(/[^0-9]/g, '').replace(/^0+/, '').length <= 15
  )
    return {
      status: 'auto_accepted',
      rule: 'number-v1',
      reason:
        'Exact numeric quantity from the recognized table’s explicitly annual column. No period conversion or formula evaluation.',
    };
  if (
    column === 'E' &&
    field.origin === 'narrative_product' &&
    productWording(cells.map((c) => c.raw.trim()).join(' ')) === field.value
  )
    return {
      status: 'auto_accepted',
      rule: 'source-span-v2',
      reason:
        'Product wording isolated deterministically from the original Item # narrative. Full original text stays in Description 2.',
    };
  if (
    column === 'F' &&
    field.origin === 'source_narrative' &&
    cells.length > 1 &&
    field.value === cells.map((c) => c.raw.trim()).join(' ')
  )
    return {
      status: 'auto_accepted',
      rule: 'join-v1',
      reason:
        'Original narrative cells joined in their cited order with surrounding whitespace trimmed. No wording or facts were invented.',
    };
  // Only literal, explicitly mapped text. Quantity, packaging and identifier meaning require review.
  if (
    ['D', 'E', 'F', 'G', 'H'].includes(column) &&
    field.direct &&
    field.origin !== 'ai' &&
    cells.length === 1 &&
    cells[0].raw.trim() === field.value
  )
    return {
      status: 'auto_accepted',
      rule: 'copy-v1',
      reason:
        'Copied exactly from the linked source cell. Source layout and complete proposal coverage still need confirmation.',
    };
  return null;
}

export function automaticExtraRule(r, f, book) {
  if (
    f.origin === 'source_date' &&
    ['pending', 'auto_accepted'].includes(f.status) &&
    !f.alternatives?.length &&
    !/conflict|review again/i.test(f.reason || '')
  ) {
    const s = book.sheets.find((s) => s.name === r.sheet),
      a = f.evidence[0];
    return !!(
      s?.hidden === 'visible' &&
      f.evidence.length === 1 &&
      !s.hiddenRows?.includes(a.replace(/\D/g, '')) &&
      sourceRole(book, s.name, a) === 'customer_specification' &&
      sourceDate(s.cells[a], book.date1904) === f.value
    );
  }
  if (
    !f.value ||
    f.origin === 'ai' ||
    !['pending', 'auto_accepted'].includes(f.status) ||
    f.alternatives?.length ||
    /conflict|review again/i.test(f.reason) ||
    !f.evidence.length
  )
    return false;
  const s = book.sheets.find((s) => s.name === r.sheet);
  return (
    s?.hidden === 'visible' &&
    f.evidence.every(
      (a) =>
        !s.hiddenRows?.includes(a.replace(/\D/g, '')) &&
        s?.cells[a] &&
        !s.cells[a].formula &&
        sourceRole(book, r.sheet, a) === 'customer_specification',
    ) &&
    f.value
      .split(/\s*\|\s*/)
      .every((v) =>
        f.evidence.some(
          (a) =>
            s.cells[a].raw.trim() === v ||
            new RegExp(
              '(^|[^A-Za-z0-9_-])' +
                v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                '($|[^A-Za-z0-9_-])',
            ).test(s.cells[a].raw),
        ),
      )
  );
}
