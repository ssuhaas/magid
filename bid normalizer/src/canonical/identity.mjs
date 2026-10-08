import { sourceRole } from './source-policy.mjs';
export const identityColumns = {
  E: 'description_primary',
  B: 'online_bid_sequence',
  C: 'customer_reference',
  I: 'manufacturer_part_primary',
  J: 'manufacturer_part_secondary',
};
export const hasProjectedIdentity = (values) =>
  Object.keys(identityColumns).some((k) => !!values[k]?.value?.trim());
/** Source-code readiness preserves an unknown namespace; it never fills a description or manufacturer slot.
 * @param {any} record @param {Record<string,string>} columns @param {any} book */
export function stockCodeReady(record, columns = {}, book = null) {
  const f = record.extras?.['Source Product ID'];
  if (
    columns['Source Product ID'] !== 'approved' ||
    record.boundary !== 'include' ||
    record.ambiguous ||
    !f?.value?.trim() ||
    /[\s|]/.test(f.value) ||
    !['auto_accepted', 'accepted', 'edited'].includes(f.status) ||
    f.alternatives?.length ||
    /conflict|review again|routing instructions/i.test(f.reason || '') ||
    f.evidence?.length !== 1 ||
    !book
  )
    return false;
  const a = f.evidence[0],
    s = book.sheets.find((s) => s.name === record.sheet),
    c = s?.cells[a];
  return (
    !!c &&
    s.hidden === 'visible' &&
    !s.hiddenRows?.includes(a.replace(/\D/g, '')) &&
    !c.formula &&
    sourceRole(book, record.sheet, a) === 'customer_specification' &&
    c.raw.trim() === f.value &&
    record.anchors.some((anchor) => anchor.replace(/\D/g, '') === a.replace(/\D/g, ''))
  );
}
export const hasMatchingIdentity = (record, columns, book) =>
  hasProjectedIdentity(record.values) || stockCodeReady(record, columns, book);
