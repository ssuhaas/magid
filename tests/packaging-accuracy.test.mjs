import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkbook, extract } from '../lib/workbook.mjs';
import { createReviewController, buildCanonical } from '../lib/canonical/bridge.mjs';
import { automateBoundaries } from '../lib/canonical/pipeline.mjs';
import { packagingConflict, labeledPackCount } from '../lib/canonical/source-facts.mjs';
import { buildScope } from '../lib/ai/client.mjs';

// Compatible with PR #2's pinned fixture setup and the existing parent workspace.
const fixtureRoot = resolve(process.env.MAGID_FIXTURE_ROOT ||
  (existsSync('tests/fixtures/attachments') ? 'tests/fixtures' : '..'));
function setup() {
  const book = readWorkbook(readFileSync(resolve(fixtureRoot,
    'attachments/e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx')));
  const records = extract(book).records;
  const controller = createReviewController();
  automateBoundaries(controller, records, book);
  controller.automate(records, book);
  const recurring = address => records.find(r => r.sheet.includes('Bid-Recurring') && r.anchors[0] === address);
  return { book, records, controller, recurring };
}

test('original Tesla pair and compact pack expressions remain focused exceptions, with exact source values preserved', () => {
  const { book, records, recurring, controller } = setup();
  assert.equal(records.length, 476);
  for (const address of ['B173', 'B283', 'B303', 'B333', 'B365', 'B376']) {
    const record = recurring(address);
    const sheet = book.sheets.find(s => s.name === record.sheet);
    assert.ok(packagingConflict(record, book), address);
    assert.equal(record.values.M.status, 'pending', address);
    assert.equal(record.values.M.value, sheet.cells[address.replace('B', 'G')].raw, address);
    assert.equal(labeledPackCount(record, book), null, address);
    assert.equal(buildCanonical({ book, records: [record], controller, columns: {}, digest: 'a'.repeat(64), templateDigest: 'b'.repeat(64), name: 'Tesla.xlsx' }).run.items[0].fields.pack_quantity.resolution, 'unresolved');
    const scope = buildScope(book, [record], { digest: 'a'.repeat(64), scopeId: address, targeted: true });
    assert.ok(scope.records[0].requestedColumns.includes('M'), address);
  }
  assert.match(packagingConflict(recurring('B173'), book), /40 PR PER BOX/);
  assert.match(packagingConflict(recurring('B283'), book), /100 PR\/CS/);
  assert.match(packagingConflict(recurring('B303'), book), /4PK/);
});

test('pair contents never become pieces merely because numeric counts match; literal matching piece counts still automate', () => {
  const { book, recurring } = setup();
  const record = recurring('B173');
  const sheet = book.sheets.find(s => s.name === record.sheet);
  sheet.cells.B173.raw = 'HAND WARMER 40 pairs per box';
  sheet.cells.F173.raw = 'BX';
  sheet.cells.G173.raw = '40';
  assert.match(packagingConflict(record, book), /pairs|pieces/i);
  for (const description of ['HAND WARMER 40/BX', 'HAND WARMER 40 per box', 'HAND WARMER 40BX']) {
    sheet.cells.B173.raw = description;
    assert.equal(packagingConflict(record, book), null, description);
  }
  sheet.cells.B173.raw = 'HAND WARMER 200 PR/BX';
  sheet.cells.G173.raw = ' 40 ';
  assert.ok(packagingConflict(record, book));
});

test('ordinary product words, dimensions and catalog tokens do not create packaging exceptions', () => {
  const { book, recurring } = setup();
  const record = recurring('B48');
  const sheet = book.sheets.find(s => s.name === record.sheet);
  for (const text of ['CUTTER BOX XCHANGE SINGLE BLADE', 'SLEEVE 22 IN PAIR', 'PART ABC4PK CUTTER', 'PART ABC-4PK CUTTER', 'GLOVE A4 CUT LEVEL 3', 'MASK 50/BOX']) {
    sheet.cells.B48.raw = text;
    sheet.cells.F48.raw = text === 'MASK 50/BOX' ? 'BX' : 'EA';
    sheet.cells.G48.raw = text === 'MASK 50/BOX' ? '50' : '1';
    assert.equal(packagingConflict(record, book), null, text);
  }
});
