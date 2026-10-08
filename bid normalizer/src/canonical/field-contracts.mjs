// Headers transcribed from the supplied Magid template; no inventory taxonomy is added.
export const fieldContracts = {
  A: {
    header: 'MASTER\nSEQ #',
    label: 'Master sequence',
    canonical: null,
    help: 'Generated output row number. This is not a source product identifier.',
  },
  B: {
    header: 'ON-LINE\nBID\nSEQ #',
    label: 'Online bid sequence',
    canonical: 'online_bid_sequence',
    help: 'Use only an explicitly identified bid-line sequence. Preserve leading zeros; do not substitute a stock code.',
  },
  C: {
    header: 'CUSTOMER\nREF #',
    label: 'Customer reference',
    canonical: 'customer_reference',
    help: 'Use a source identifier explicitly identified as the customer reference. An unlabeled stock code belongs in a proposed additional column.',
  },
  D: {
    header: 'PRODUCT\nCATEGORY',
    label: 'Product category',
    canonical: 'output_category',
    help: 'Use the source product category or a reviewer-approved source-backed wording. No inventory category is inferred.',
  },
  E: {
    header: 'CUSTOMER\nITEM DESCRIPTION 1',
    label: 'Description 1',
    canonical: 'description_primary',
    help: 'Cleaned product wording for narrative proposals; preserve useful specifications. The full source narrative belongs in Description 2. Preserve an explicitly supplied tabular Description 1.',
  },
  F: {
    header: 'CUSTOMER\nITEM DESCRIPTION 2',
    label: 'Description 2',
    canonical: 'description_secondary',
    help: 'Full original item narrative for combined narrative proposals, including source codes and ordering instructions. Preserve an explicitly supplied tabular Description 2; leave blank when neither is available.',
  },
  G: {
    header: 'SIZE',
    label: 'Size',
    canonical: 'size',
    help: 'Preserve the stated size, including unusual tokens such as 2L. Do not guess a replacement size system.',
  },
  H: {
    header: 'CUSTOMER\nMFR NAME',
    label: 'Manufacturer',
    canonical: 'manufacturer_name',
    help: 'Manufacturer named in the customer requirement. Supplier routing instructions and alternate-quote vendors are not manufacturer facts.',
  },
  I: {
    header: 'CUSTOMER\nMFR PART # 1',
    label: 'Manufacturer part 1',
    canonical: 'manufacturer_part_primary',
    help: 'Use a source code explicitly identified as a manufacturer part number. Preserve leading zeros and punctuation.',
  },
  J: {
    header: 'CUSTOMER\nMFR PART # 2',
    label: 'Manufacturer part 2',
    canonical: 'manufacturer_part_secondary',
    help: 'A second source manufacturer part number. Do not duplicate the first part or relabel an unlabeled adjacent code.',
  },
  K: {
    header: 'ANNUAL\nUSAGE',
    label: 'Annual usage',
    canonical: 'annual_usage',
    help: 'An explicitly annual numeric quantity; zero is valid. Monthly, dated, as-needed or period-unknown quantities must not be annualized.',
  },
  L: {
    header: 'CUSTOMER\nUOM',
    label: 'Customer UOM',
    canonical: 'customer_uom',
    help: 'Customer unit of measure. Confirm its relationship to usage and packaging; preserve unfamiliar units rather than guessing aliases.',
  },
  M: {
    header: 'QTY/UOM',
    label: 'Qty / UOM',
    canonical: 'pack_quantity',
    help: 'Reviewed count per customer container unit, from 1 to 50,000. Keep pair counts distinct from pieces; leave unresolved pack conflicts blank.',
  },
};
const normalize = (v) => String(v).replace(/\s+/g, ' ').trim();
export function assertTemplateContract(book) {
  const sheet = book.sheets.find((s) => s.name === 'AI BID IDENTIFICATION TEMPLATE');
  if (!sheet) throw Error('Expected template sheet is missing.');
  for (const [column, contract] of Object.entries(fieldContracts)) {
    const cell = sheet.cells[column + '1'];
    if (!cell || cell.formula || normalize(cell.raw) !== normalize(contract.header))
      throw Error(
        'Template field contract changed at ' +
          column +
          '1. Restore the original Magid template before exporting.',
      );
  }
  for (const address of Object.keys(sheet.cells))
    if (/^[A-Z]+1$/.test(address) && !Object.hasOwn(fieldContracts, address.slice(0, -1)))
      throw Error(
        'The base template already contains additional columns. Restore the original Magid template before exporting.',
      );
  return sheet;
}
