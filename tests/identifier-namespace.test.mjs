import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from '../lib/workbook.mjs';
import { labeledIdentifier } from '../lib/canonical/source-facts.mjs';
import { createReviewController } from '../lib/canonical/bridge.mjs';
import { buildScope } from '../lib/ai/client.mjs';
import { validateProposal } from '../lib/ai/contracts.mjs';

function fixture() {
  const cell = raw => ({ raw, type: 's', formula: null });
  const sheet = { name: 'Bid', hidden: 'visible', hiddenRows: [], cells: {
    A1: cell('Manufacturer Part Number'), A2: cell('000111'),
    A3: cell('Distributor Part Number'), A4: cell('000123'), B4: cell('Glove'),
  }};
  const book = { sheets: [sheet] }, record = makeRecord(sheet, ['B4']);
  record.values.I = { value: '000123', evidence: ['A4'], direct: true, status: 'pending', reason: 'Mapped source code' };
  return { book, sheet, record };
}

test('a newer distributor or generic identifier heading cannot inherit an older manufacturer namespace', () => {
  const { book, sheet, record } = fixture();
  for (const heading of ['Distributor Part Number', 'Part #', 'Customer Reference Number', 'Supplier SKU', 'Stock Code']) {
    sheet.cells.A3.raw = heading;
    assert.equal(labeledIdentifier(record, 'I', record.values.I, book), null, heading);
    createReviewController().automate([record], book);
    assert.equal(record.values.I.status, 'pending', heading);
  }
  sheet.cells.A3.raw = 'Manufacturer Part Number';
  assert.equal(labeledIdentifier(record, 'I', record.values.I, book).header, 'A3');
  sheet.hiddenRows = ['3'];
  assert.equal(labeledIdentifier(record, 'I', record.values.I, book), null);
});

test('AI scope supplies intervening headings and rejects borrowing namespace evidence from another column or section', () => {
  const { book, sheet, record } = fixture();
  const input = buildScope(book, [record], { digest: 'a'.repeat(64), scopeId: 'namespace' });
  assert.equal(input.cells.find(c => c.cell === 'A3').contextRole, 'header');
  const proposal = { items: [{ recordId: record.id, sheet: 'Bid', anchors: ['B4'], section: '', ambiguous: false,
    boundaryReason: 'One item', extras: [], fields: [{ column: 'I', value: '000123', kind: 'source_span', identifierType: 'manufacturer',
      reason: 'Source code', evidence: [{ sheet: 'Bid', cell: 'A4', quote: '000123' }, { sheet: 'Bid', cell: 'A1', quote: 'Manufacturer Part Number' }] }]}], warnings: [] };
  assert.throws(() => validateProposal(input, proposal), /current source-column namespace/);
  sheet.cells.A3.raw = 'Manufacturer Part Number';
  const updated = buildScope(book, [record], { digest: input.digest, scopeId: 'current-heading' });
  proposal.items[0].fields[0].evidence[1].cell = 'A3';
  assert.doesNotThrow(() => validateProposal(updated, proposal));
  sheet.cells.A3.raw = 'Part #';
  sheet.cells.C1 = { raw: 'Manufacturer Part Number', type: 's', formula: null };
  proposal.items[0].fields[0].evidence[1].cell = 'C1';
  const otherColumn = buildScope(book, [record], { digest: input.digest, scopeId: 'other-column' });
  assert.throws(() => validateProposal(otherColumn, proposal), /current source-column namespace/);
});
