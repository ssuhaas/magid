import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from '../lib/workbook.mjs';
import { createReviewController } from '../lib/canonical/bridge.mjs';
import { buildScope } from '../lib/ai/client.mjs';
import { validateProposal, partitionProposal } from '../lib/ai/contracts.mjs';

function fixture() {
  const sheet = { name: 'Bid', hidden: 'visible', hiddenRows: [], cells: {
    A1: { raw: 'Glove', type: 's', formula: null },
  }};
  const book = { sheets: [sheet] }, record = makeRecord(sheet, ['A1']);
  record.values.E = { value: 'Glove', evidence: ['A1'], reason: 'Literal source', direct: true, status: 'pending' };
  createReviewController().automate([record], book);
  const scope = buildScope(book, [record], { digest: 'a'.repeat(64), scopeId: 'target', targeted: true });
  return { book, record, scope };
}

test('targeted extraction excludes proven literals and human decisions, but retains potential missing facts', () => {
  const { book, record, scope } = fixture();
  assert.ok(!scope.records[0].requestedColumns.includes('E'));
  assert.ok(scope.records[0].requestedColumns.includes('H'));
  assert.equal(scope.records[0].currentValues.E, 'Glove');
  record.values.L.status = 'blank';
  record.values.G.status = 'edited';
  record.values.H.status = 'accepted';
  const updated = buildScope(book, [record], { digest: scope.digest, scopeId: 'updated', targeted: true });
  assert.ok(['G', 'H', 'L'].every(c => !updated.records[0].requestedColumns.includes(c)));
  record.values.E.value = 'Invented';
  assert.ok(buildScope(book, [record], { digest: scope.digest, scopeId: 'changed', targeted: true }).records[0].requestedColumns.includes('E'));
});

test('out-of-scope suggestions cannot overwrite resolved fields or create approval tasks', () => {
  const { record, scope } = fixture();
  const proposal = { items: [{ recordId: record.id, sheet: record.sheet, anchors: record.anchors,
    section: '', ambiguous: false, boundaryReason: 'One occurrence', extras: [], fields: [{
      column: 'E', value: 'Glove', kind: 'source_span', identifierType: 'not_identifier',
      reason: 'Exact source', evidence: [{ sheet: 'Bid', cell: 'A1', quote: 'Glove' }],
    }]}], warnings: [] };
  assert.throws(() => validateProposal(scope, proposal), /unresolved-field scope/);
  const result = partitionProposal(scope, proposal);
  assert.deepEqual(result.proposal.items[0].fields, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.proposal.items.length, 1);
});
