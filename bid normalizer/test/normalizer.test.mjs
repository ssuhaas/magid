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
      fields: propose(scope, r), extras: [] })), warnings: [],
      ...(scope.mode === 'discover' ? { nonItems: scope.cells.filter(c => c.eligibleAnchor &&
        !records.some(r => r.anchors.includes(c.cell))).map(c => ({ sheet: c.sheet, cell: c.cell,
          disposition: 'context', quote: c.raw, reason: 'Explicit non-product source context.' })) } : {}) };
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

const productField = (scope, r) => [{ column: 'E', value: scope.cells.find(c => c.cell === r.anchors[0]).raw,
  kind: 'source_span', identifierType: 'not_identifier',
  evidence: [{ sheet: r.sheet, cell: r.anchors[0], quote: scope.cells.find(c => c.cell === r.anchors[0]).raw }],
  reason: 'Original product wording.' }];

test('a recognized sheet still discovers a second table and a parallel lane', async () => {
  const provider = controlledProvider(productField);
  const cells = readWorkbook(tesla()).sheets[0].cells;
  const values = { ...Object.fromEntries(Object.entries(cells).map(([a, c]) => [a, c.raw])),
    A20: 'Product: Helmet' };
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(source(values, 'Bundled Bid-Recurring')));
  assert.equal(out.cells.E3.raw, 'Product: Helmet');
  assert.ok(provider.calls.some(c => c.scope.mode === 'discover'));
  const lane = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(source({
    A1: 'Item', B1: 'Part #', D1: 'Item', E1: 'Part #', G1: 'Item', H1: 'Part #',
    B4: '001AB', K4: 'Product: Visor' })));
  assert.equal(lane.cells.E3.raw, 'Product: Visor');
});

test('known tables include product rows beyond the original sample endpoints', async () => {
  const provider = controlledProvider(() => []);
  for (const [name, values, expected] of [
    ['Bundled Bid-Recurring', { B4: 'Item Description', E4: 'Manufacturer Part Number', B501: 'Last Tesla glove' }, 'Last Tesla glove'],
    ['Approved Req', { D6: 'Description', B6: 'Quantity', D400: 'Last Daikin glove' }, 'Last Daikin glove'],
    ['Bid', { E17: 'Annual usage', D17: 'Product model', C70: 'Last Hyundai glove' }, 'Last Hyundai glove'],
  ]) {
    const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(source(values, name)));
    assert.equal(out.cells.E2.raw, expected);
  }
});

test('uncertain discovery and missed product cells retain original source instead of blocking export', async () => {
  for (const transform of [
    p => ({ ...p, items: [] }),
    p => ({ ...p, items: [], nonItems: [{ sheet: 'Bid', cell: 'A1', disposition: 'context', quote: 'Product: Glove', reason: 'Uncertain item.' }] }),
    p => ({ ...p, items: p.items.map(i => ({ ...i, fields: [] })) }),
    p => ({ ...p, items: p.items.map(i => ({ ...i, ambiguous: true })) }),
    p => ({ ...p, warnings: ['Possible missing products.'] }),
  ]) {
    const provider = controlledProvider(productField);
    const fetchImpl = async (...args) => {
      const response = await provider.fetchImpl(...args), body = await response.json();
      const text = body.output[0].content[0]; text.text = JSON.stringify(transform(JSON.parse(text.text)));
      return Response.json(body);
    };
    const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl })(source({ A1: 'Product: Glove' })));
    assert.equal(out.cells.E2?.raw || out.cells.F2?.raw, 'Product: Glove');
  }
});

test('a partially mapped proposal still discovers unmapped products', async () => {
  const provider = controlledProvider(productField);
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(
    source({ A1: 'Mapped glove', A3: 'Product: Helmet' }),
    { mapping: { sheet: 'Bid', start: 1, end: 1, columns: { E: 'A' } } }));
  assert.equal(out.cells.E2.raw, 'Mapped glove');
  assert.equal(out.cells.E3.raw, 'Product: Helmet');
});

test('wrapped discoveries stay together and separate repeated source occurrences remain separate', async () => {
  const provider = controlledProvider(productField);
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(
    source({ A1: 'Product: Glove', A3: 'Product: Glove' })));
  assert.equal(out.cells.E2.raw, 'Product: Glove'); assert.equal(out.cells.E3.raw, 'Product: Glove');
  const fetchImpl = async (url, options) => {
    const scope = JSON.parse(JSON.parse(options.body).input[0].content);
    const proposal = { items: [{ recordId: '', sheet: 'Bid', anchors: ['A1', 'A2'], section: '',
      ambiguous: false, boundaryReason: 'One wrapped product.', fields: [{ column: 'E', value: 'Product: Glove XL',
        kind: 'interpretation', identifierType: 'not_identifier', reason: 'Full wrapped description.',
        evidence: scope.cells.map(c => ({ sheet: c.sheet, cell: c.cell, quote: c.raw })) }], extras: [] }],
      nonItems: [], warnings: [] };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] });
  };
  assert.equal(identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl })(source({ A1: 'Product: Glove', A2: 'XL' }))).cells.E2.raw, 'Product: Glove XL');
});

test('long unknown blocks and hidden product rows continue without losing source text', async () => {
  const values = Object.fromEntries(Array.from({ length: 102 }, (_, i) => ['A' + (i + 1), 'Product: Glove']));
  const provider = controlledProvider(productField);
  const normalize = createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl });
  const out = identification(await normalize(source(values)));
  assert.equal(Object.keys(out.cells).filter(a => /^A\d+$/.test(a)).length - 1, 102);
  const { unzipSync, strFromU8 } = await import('fflate');
  const zip = unzipSync(source({ A1: 'Product: Glove' }));
  const path = 'xl/worksheets/sheet1.xml';
  zip[path] = strToU8(strFromU8(zip[path]).replace('<row r="1">', '<row r="1" hidden="1">'));
  const hidden = identification(await normalize(zipSync(zip)));
  assert.equal(hidden.cells.F2.raw, 'Product: Glove');
});

test('ambiguous stock groups are recovered into individual products instead of placeholder rows', async () => {
  const fetchImpl = async (url, options) => {
    const scope = JSON.parse(JSON.parse(options.body).input[0].content);
    const codes = scope.cells.filter(c => c.eligibleAnchor && /^[DEF](35|36)$/.test(c.cell));
    const items = scope.mode === 'discover' ? codes.map(c => ({ recordId: '', sheet: c.sheet,
      anchors: [c.cell], section: '', ambiguous: false, boundaryReason: 'A separate product code.', fields: [],
      extras: [{ name: 'Source Product ID', meaning: 'Original unresolved product namespace.',
        benefit: 'Identify each product for matching.', value: c.raw, reason: 'Literal source code.',
        evidence: [{ sheet: c.sheet, cell: c.cell, quote: c.raw }] }] })) : [];
    const nonItems = scope.mode === 'discover' ? scope.cells.filter(c => c.eligibleAnchor && !codes.includes(c)).map(c => ({
      sheet: c.sheet, cell: c.cell, disposition: 'header', quote: c.raw, reason: 'Item list heading.' })) : undefined;
    const proposal = { items, warnings: [], ...(nonItems ? { nonItems } : {}) };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] });
  };
  const bytes = await createBidNormalizer({ key: 'synthetic-key', fetchImpl })(source({
    A1: 'Item', B1: 'Part #', D1: 'Item', E1: 'Part #', G1: 'Item', H1: 'Part #',
    D35: '001AB', E35: '002CD', F35: '003EF', D36: '004GH', E36: '005IJ', F36: '006KL' }));
  const sheet = identification(bytes);
  assert.equal(Object.keys(sheet.cells).filter(a => /^A\d+$/.test(a)).length - 1, 6);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => sheet.cells['N' + (i + 2)].raw),
    ['001AB', '002CD', '003EF', '004GH', '005IJ', '006KL']);
});

test('a second product table beyond Tesla quote columns is not silently excluded', async () => {
  const provider = controlledProvider(productField);
  const values = Object.fromEntries(Object.entries(readWorkbook(tesla()).sheets[0].cells).map(([a, c]) => [a, c.raw]));
  values.P19 = 'Item Description'; values.P20 = 'Product: Helmet';
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(source(values, 'Bundled Bid-Recurring')));
  assert.equal(out.cells.E3.raw, 'Product: Helmet');
});

test('enrichment boundary concerns do not require a reviewer or block export', async () => {
  const provider = controlledProvider(() => []);
  const fetchImpl = async (...args) => {
    const response = await provider.fetchImpl(...args), body = await response.json();
    const block = body.output[0].content[0], proposal = JSON.parse(block.text);
    proposal.items[0].ambiguous = true; block.text = JSON.stringify(proposal);
    return Response.json(body);
  };
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl })(tesla()));
  assert.equal(out.cells.E2.raw, 'Gloves size XL');
  assert.equal(out.cells.F2.raw, 'Gloves size XL');
});

test('an all-context discovery result retains source rows instead of requiring approval', async () => {
  const provider = controlledProvider(() => []);
  const out = identification(await createBidNormalizer({ key: 'synthetic-key', fetchImpl: provider.fetchImpl })(source({ A1: 'Glove XL, code 00123' })));
  assert.equal(out.cells.F2.raw, 'Glove XL, code 00123');
});

test('contradictory duplicate anchors remain invalid rather than confidence decisions', async () => {
  const provider = controlledProvider(productField);
  const fetchImpl = async (...args) => {
    const response = await provider.fetchImpl(...args), body = await response.json();
    const block = body.output[0].content[0], proposal = JSON.parse(block.text);
    proposal.items.push(proposal.items[0]); block.text = JSON.stringify(proposal);
    return Response.json(body);
  };
  await assert.rejects(createBidNormalizer({ key: 'synthetic-key', fetchImpl })(source({ A1: 'Product: Glove' })), /contract validation/);
});
