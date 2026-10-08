import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from './helpers/fixtures.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { createBidNormalizer } from '../bid normalizer/index.mjs';
import { readWorkbook, extract } from '../lib/workbook.mjs';
import { prepareDescriptions } from '../lib/description-policy.mjs';

const cases = [
  ['Daikin', '8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx', 338, 113],
  ['Hyundai', 'a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx', 35, 12],
  ['Tesla', 'e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx', 476, 159],
  ['Grainger', 'fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx', 31, 11],
  ['Berry', '5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx', 76, 10],
];
for (const [name, path, count, expectedRequests] of cases) {
  test(`${name}: portable API preserves source occurrences or explicitly rejects unresolved coverage`, async () => {
    const input = readFileSync('../attachments/' + path);
    const original = prepareDescriptions(extract(readWorkbook(input)).records, readWorkbook(input));
    let requests = 0;
    const normalize = createBidNormalizer({ key: 'synthetic-key', fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      const scope = JSON.parse(body.input[0].content);
      assert.equal(scope.source, undefined, 'never call evaluation');
      if (scope.mode === 'enrich') requests++;
      const proposal = { items: scope.records.map(r => ({ recordId: r.id, sheet: r.sheet,
        anchors: r.anchors, section: '', ambiguous: false, boundaryReason: 'Original source occurrence.',
        fields: [], extras: [] })), warnings: [],
        ...(scope.mode === 'discover' ? { nonItems: scope.cells.filter(c => c.eligibleAnchor).map(c => ({
          sheet: c.sheet, cell: c.cell, disposition: 'context', quote: c.raw,
          reason: 'Controlled fixture context; this test does not certify live semantic classification.' })) } : {}) };
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [
        { type: 'output_text', text: JSON.stringify(proposal) },
      ] }] });
    } });
    if (name === 'Berry') {
      // The old parser collapsed several stock codes into two ambiguous groups.
      // An AI response that calls those missing products context must not export 74 rows.
      await assert.rejects(normalize(input, { filename: path.split('/').at(-1) }), /Missing product occurrence at Sheet1!/);
      return;
    }
    const bytes = await normalize(input, { filename: path.split('/').at(-1) });
    assert.equal(requests, expectedRequests);
    const out = readWorkbook(bytes), sheet = out.sheets.find(s => s.name === 'AI BID IDENTIFICATION TEMPLATE');
    assert.equal(Object.keys(sheet.cells).filter(a => /^A\d+$/.test(a)).length - 1, count);
    for (const [index, record] of original.entries()) {
      assert.equal(sheet.cells['A' + (index + 2)].raw, String(index + 1));
      assert.equal(sheet.cells['E' + (index + 2)]?.raw || '', record.values.E.value);
      if (record.values.F.origin === 'source_narrative')
        assert.equal(sheet.cells['F' + (index + 2)].raw, record.values.F.value);
    }
    const sourceZip = unzipSync(readFileSync('public/template.xlsx')), outputZip = unzipSync(bytes);
    for (const other of out.sheets.filter(s => s !== sheet))
      assert.equal(strFromU8(outputZip[other.path]), strFromU8(sourceZip[other.path]));
  });
}
