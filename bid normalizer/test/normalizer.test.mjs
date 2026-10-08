import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { createBidNormalizer } from '../index.mjs';
import { readWorkbook } from '../src/workbook.mjs';

export function source(cells, name = 'Bid') {
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const rows = new Map();
  for (const [a, raw] of Object.entries(cells)) {
    const n = a.replace(/\D/g, '');
    if (!rows.has(n)) rows.set(n, []);
    rows.get(n).push(`<c r="${a}" t="inlineStr"><is><t>${escape(raw)}</t></is></c>`);
  }
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[...rows].map(([n, values]) => `<row r="${n}">${values.join('')}</row>`).join('')}</sheetData></worksheet>`,
  }).map(([path, value]) => [path, strToU8(value)])));
}

const stock = () => source({ A1: 'Item', B1: 'Part #', D1: 'Item', E1: 'Part #',
  G1: 'Item', H1: 'Part #', A3: 'Goggles', B4: '001AB', E4: '02CD' });
const tesla = () => source({ B4: 'Item Description', D4: 'Manufacturer Name',
  E4: 'Manufacturer Part Number', F4: 'Unit of Measure', G4: '# of Pieces in a UoM',
  I4: 'Annual Volume', B5: 'Gloves size XL', D5: 'Acme', E5: '000123', F5: 'Each',
  I5: '0' }, 'Bundled Bid-Recurring');

export function controlledProvider(propose = () => []) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const scope = JSON.parse(body.input[0].content);
    assert.equal(scope.source, undefined, 'no evaluation requests');
    calls.push({ url, scope });
    const records = scope.mode === 'discover'
      ? scope.cells.filter(c => c.raw.startsWith('Product:')).map(c => ({ id: '', sheet: c.sheet, anchors: [c.cell] }))
      : scope.records;
    const proposal = { items: records.map(r => ({ recordId: r.id, sheet: r.sheet,
      anchors: r.anchors, section: '', ambiguous: false, boundaryReason: 'One original item.',
      fields: propose(scope, r), extras: [] })), warnings: [] };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: JSON.stringify(proposal) },
    ] }] });
  };
  return { calls, fetchImpl };
}
const identification = bytes => readWorkbook(bytes).sheets.find(s => s.name === 'AI BID IDENTIFICATION TEMPLATE');

test('closed stock lists return Excel without credentials, review, sidecars or provider calls', async () => {
  const normalize = createBidNormalizer({ fetchImpl: () => { throw Error('Unexpected AI'); } });
  const bytes = await normalize(stock());
  assert.ok(bytes instanceof Uint8Array);
  const out = identification(bytes);
  assert.equal(out.cells.N2.raw, '001AB');
  assert.equal(out.cells.D2.raw, 'Goggles');
  assert.equal(out.cells.N3.raw, '02CD');
  assert.equal(out.cells.E2, undefined);
});

test('server extraction populates source-backed AI size, preserves direct identity and annual zero', async () => {
  const provider = controlledProvider((scope, r) => [{ column: 'G', value: 'XL', kind: 'source_span',
    identifierType: 'not_identifier', evidence: [{ sheet: r.sheet, cell: 'B5', quote: 'XL' }],
    reason: 'Explicit size token.' }]);
  const normalize = createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl });
  const out = identification(await normalize(tesla()));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.ok(!provider.calls[0].scope.records[0].requestedColumns.includes('I'));
  assert.equal(out.cells.G2.raw, 'XL');
  assert.equal(out.cells.I2.raw, '000123');
  assert.equal(out.cells.K2.raw, '0');
  assert.equal(out.cells.L2.raw, 'EA');
  assert.equal(out.cells.M2, undefined, 'never infer each = one');
});

test('rejected guesses stay blank without blocking automated output', async () => {
  const provider = controlledProvider((scope, r) => [{ column: 'G', value: 'L', kind: 'source_span',
    identifierType: 'not_identifier', evidence: [{ sheet: r.sheet, cell: 'B5', quote: 'XL' }],
    reason: 'Incorrect shortened size.' }]);
  const bytes = await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(tesla());
  assert.equal(identification(bytes).cells.G2, undefined);
});

test('unrecognized layouts use bounded AI discovery and still return the template', async () => {
  const provider = controlledProvider((scope, r) => [{ column: 'E', value: 'Glove', kind: 'source_span',
    identifierType: 'not_identifier', evidence: [{ sheet: r.sheet, cell: r.anchors[0], quote: 'Glove' }],
    reason: 'Explicit product wording.' }]);
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(
    source({ A1: 'Product: Glove' })));
  assert.equal(provider.calls[0].scope.mode, 'discover');
  assert.equal(out.cells.E2.raw, 'Glove');
});

test('input, template, missing credentials, cancellation and provider failures return no partial workbook', async () => {
  await assert.rejects(createBidNormalizer()(new Uint8Array([1, 2, 3])), /Excel|ZIP|container/);
  await assert.rejects(createBidNormalizer()(stock(), { filename: 'proposal.csv' }), /xlsx/);
  await assert.rejects(createBidNormalizer()(tesla()), /credential/);
  await assert.rejects(createBidNormalizer({ templateBytes: stock() })(stock()), /template sheet/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(createBidNormalizer()(stock(), { signal: abort.signal }), /canceled/);
  await assert.rejects(createBidNormalizer({ key: 'do-not-print-this',
    fetchImpl: async () => Response.json({}, { status: 401 }) })(tesla()), error =>
      /not authorized/.test(error.message) && !error.message.includes('do-not-print-this'));
});

test('a reusable factory isolates each call and caller diagnostics cannot affect the workbook', async () => {
  const normalize = createBidNormalizer();
  const [a, b] = await Promise.all([
    normalize(stock(), { onProgress: () => { throw Error('Observer failed'); } }),
    normalize(source({ A1: 'Item', B1: 'Part #', D1: 'Item', E1: 'Part #', G1: 'Item', H1: 'Part #', B4: '009ZZ' })),
  ]);
  assert.equal(identification(a).cells.N2.raw, '001AB');
  assert.equal(identification(b).cells.N2.raw, '009ZZ');
});
