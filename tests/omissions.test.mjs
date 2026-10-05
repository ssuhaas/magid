import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from './helpers/fixtures.mjs';
import { createHash } from 'node:crypto';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readWorkbook, extract, openZip, checkReady } from '../lib/workbook.mjs';
import { prepareDescriptions } from '../lib/description-policy.mjs';
import { createReviewController } from '../lib/canonical/bridge.mjs';
import {
  automateBoundaries,
  automateCoverage,
  pruneRedundantExtras,
} from '../lib/canonical/pipeline.mjs';
import { coverageIndex, currentCoverage } from '../lib/canonical/coverage.mjs';
import {
  declineExtraInformation,
  approveExtraInformation,
  omitProposalInformation,
} from '../lib/canonical/omissions.mjs';
import { finalReadiness, exportReviewedWorkbook } from '../lib/canonical/export.mjs';
import { identifierLoss } from '../lib/identifier-retention.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const templateBytes = readFileSync('public/template.xlsx');

function setup(withExtra = true) {
  const source = readFileSync(
    '../attachments/fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx',
  );
  const files = openZip(source);
  // A controlled extra instruction added to the real workbook; never a gold source fixture.
  files['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(files['xl/worksheets/sheet1.xml']).replace(
      '</row>',
      '<c r="Z1" t="inlineStr"><is><t>Contact purchasing before delivery.</t></is></c></row>',
    ),
  );
  const proposalBytes = zipSync(files);
  const book = readWorkbook(proposalBytes);
  const records = prepareDescriptions(extract(book).records, book);
  pruneRedundantExtras(records);
  if (withExtra)
    records[0].extras['Delivery instructions'] = {
      value: 'Contact purchasing before delivery.',
      evidence: ['Z1'],
      status: 'pending',
      origin: 'ai',
      reason: 'Candidate optional instruction.',
    };
  const controller = createReviewController();
  automateBoundaries(controller, records, book);
  controller.automate(records, book);
  const columns = withExtra ? { 'Delivery instructions': 'pending' } : {};
  return {
    book,
    records,
    controller,
    columns,
    name: 'Grainger-with-test-instruction.xlsx',
    proposalBytes,
    templateBytes,
    digest: hash(proposalBytes),
    templateDigest: hash(templateBytes),
    expectedSourceDigest: hash(proposalBytes),
    coverageConfirmed: false,
  };
}

test('declining an optional instruction clears its column and coverage blockers through real export/readback', async () => {
  const s = setup();
  s.coverageConfirmed = automateCoverage(s.controller, s.book, s.records, s.columns).complete;
  assert.ok(finalReadiness(s).messages.length);
  const before = structuredClone(s.records);
  s.columns = declineExtraInformation({ ...s, name: 'Delivery instructions' });
  s.coverageConfirmed = automateCoverage(s.controller, s.book, s.records, s.columns).complete;
  assert.deepEqual(s.records, before, 'Declining never approves, blanks, or edits item values.');
  assert.equal(s.records[0].extras['Delivery instructions'].status, 'pending');
  assert.deepEqual(finalReadiness(s).messages, []);
  const output = readWorkbook(await exportReviewedWorkbook(s)).sheets.find(
    (sheet) => sheet.name === 'AI BID IDENTIFICATION TEMPLATE',
  );
  assert.equal(output.cells.N1, undefined);
  assert.equal(output.cells.E2.raw, s.records[0].values.E.value);
});

test('an explicit no on proposal context resolves coverage and permits export without an extra column', async () => {
  const s = setup(false);
  assert.equal(automateCoverage(s.controller, s.book, s.records).complete, false);
  omitProposalInformation({ ...s, sheet: 'Sheet1', addresses: ['Z1'] });
  s.coverageConfirmed = automateCoverage(s.controller, s.book, s.records).complete;
  assert.deepEqual(finalReadiness(s).messages, []);
  const output = await exportReviewedWorkbook(s);
  assert.ok(output.length);
});

test('omission protects item evidence and re-adding a column reopens its omitted source', () => {
  const s = setup();
  const revision = s.controller.revision;
  assert.throws(
    () => omitProposalInformation({ ...s, sheet: 'Sheet1', addresses: ['A2'] }),
    /supplies item information/,
  );
  assert.equal(s.controller.revision, revision);
  s.columns = declineExtraInformation({ ...s, name: 'Delivery instructions' });
  assert.equal(
    currentCoverage(s.controller, coverageIndex(s.book, s.records, s.controller), 'Sheet1', 'Z1')
      .disposition,
    'excluded',
  );
  s.columns = approveExtraInformation({ ...s, name: 'Delivery instructions' });
  assert.equal(
    currentCoverage(s.controller, coverageIndex(s.book, s.records, s.controller), 'Sheet1', 'Z1'),
    null,
  );
  assert.ok(
    checkReady(s.records, s.columns, true, s.book).some((message) =>
      message.includes('approved extra'),
    ),
  );
});

test('a deliberate code-column decline permits omission while unresolved choices and missing identities still block', () => {
  const s = setup(false),
    record = s.records[0];
  record.sourceProductID = { value: '22EY58' };
  record.values.F.value = '';
  assert.equal(identifierLoss([record], {}).length, 1);
  assert.equal(identifierLoss([record], { 'Source Product ID': 'declined' }).length, 0);
  record.values.E.value = '';
  assert.ok(
    checkReady([record], { 'Source Product ID': 'declined' }, true, s.book).some((message) =>
      message.includes('supported template identity'),
    ),
  );
});

test('every optional column needs a decision; shared instruction sources reopen if either column is re-added', () => {
  const s = setup();
  s.records[0].extras['Proposal instructions'] = structuredClone(
    s.records[0].extras['Delivery instructions'],
  );
  s.columns['Proposal instructions'] = 'pending';
  s.columns = declineExtraInformation({ ...s, name: 'Delivery instructions' });
  s.coverageConfirmed = automateCoverage(s.controller, s.book, s.records, s.columns).complete;
  assert.ok(finalReadiness(s).messages.some((message) => /column/i.test(message)));
  s.columns = declineExtraInformation({ ...s, name: 'Proposal instructions' });
  s.coverageConfirmed = automateCoverage(s.controller, s.book, s.records, s.columns).complete;
  assert.deepEqual(finalReadiness(s).messages, []);
  s.columns = approveExtraInformation({ ...s, name: 'Delivery instructions' });
  assert.equal(
    currentCoverage(s.controller, coverageIndex(s.book, s.records, s.controller), 'Sheet1', 'Z1'),
    null,
  );
  assert.ok(finalReadiness(s).messages.length);
});
