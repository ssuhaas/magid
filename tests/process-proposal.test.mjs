import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScope } from '../lib/ai/client.mjs';
import { processStages } from '../lib/ai/stages.mjs';
import { processProposalScopes } from '../lib/ai/process-proposal.mjs';
import { makeRecord } from '../lib/workbook.mjs';

function fixture() {
  const book = {
    sheets: [
      {
        name: 'Items',
        hidden: 'visible',
        hiddenRows: [],
        cells: {
          A1: { raw: 'Glove', type: 's', formula: null },
          A2: { raw: 'Helmet', type: 's', formula: null },
        },
      },
    ],
  };
  const baseline = ['A1', 'A2'].map((address) => makeRecord(book.sheets[0], [address]));
  const sourceDigest = 'a'.repeat(64);
  let sequence = 0;
  const createScopeId = () => `scope-${++sequence}`;
  const scopes = [buildScope(book, baseline, { digest: sourceDigest, scopeId: createScopeId() })];
  return {
    book,
    baseline,
    scopes,
    sourceDigest,
    createScopeId,
    cache: new Map(),
    signal: new AbortController().signal,
    check: () => {},
    observer: () => {},
    progress: () => {},
  };
}

function response(scope) {
  const proposal = {
    items: scope.records.map((record) => {
      const source = scope.cells.find((cell) => cell.cell === record.anchors[0]);
      return {
        recordId: record.id,
        sheet: record.sheet,
        anchors: record.anchors,
        section: '',
        ambiguous: false,
        boundaryReason: 'One source occurrence.',
        fields: [
          {
            column: 'E',
            value: source.raw,
            kind: 'source_span',
            identifierType: 'not_identifier',
            reason: 'Exact source wording.',
            evidence: [{ sheet: record.sheet, cell: source.cell, quote: source.raw }],
          },
        ],
        extras: [],
      };
    }),
    warnings: [],
  };
  const evaluation = {
    items: proposal.items.map((item) => ({
      recordId: item.recordId,
      sheet: item.sheet,
      anchors: item.anchors,
      boundary: 'supported',
      reason: 'One source occurrence.',
      missing: [],
      fields: item.fields.map(({ column, value, evidence, reason }) => ({
        column,
        value,
        evidence,
        reason,
        verdict: 'supported',
      })),
    })),
  };
  return { digest: scope.digest, scopeId: scope.scopeId, proposal, evaluation };
}

test('staged proposal results preserve baseline records and require independent evaluation', async () => {
  const options = fixture();
  const original = structuredClone(options.baseline);
  const result = await processProposalScopes({
    ...options,
    process: async (scope) => response(scope),
  });
  assert.deepEqual(options.baseline, original);
  assert.deepEqual(
    result.proposed.map((item) => item.values.E.value),
    ['Glove', 'Helmet'],
  );
  assert.equal(result.evaluations.length, 1);
  assert.ok(result.proposed.every((item) => item.values.E.status === 'pending'));

  await assert.rejects(
    processProposalScopes({
      ...fixture(),
      process: async (scope) => ({
        ...response(scope),
        evaluation: { items: [] },
      }),
    }),
  );
});

test('only eligible multi-item failures split the session queue; retry reuses completed stages', async () => {
  const options = fixture();
  const original = structuredClone(options.baseline);
  const calls = [];
  let failSecondEvaluation = true;
  const process = (scope, stageOptions) =>
    processStages(scope, {
      ...stageOptions,
      send: async (stage) => {
        calls.push([scope.scopeId, stage, scope.records.length]);
        if (scope.records.length > 1) throw Object.assign(Error('Timed out'), { status: 504 });
        if (scope.records[0].anchors[0] === 'A2' && stage === 'evaluate' && failSecondEvaluation) {
          failSecondEvaluation = false;
          throw Object.assign(Error('Evaluation failed'), { status: 502 });
        }
        return response(scope);
      },
    });
  await assert.rejects(processProposalScopes({ ...options, process }), /Evaluation failed/);
  assert.deepEqual(options.baseline, original);
  assert.deepEqual(
    options.scopes.map((scope) => scope.records.length),
    [1, 1],
  );
  const callsBeforeRetry = calls.length;
  const result = await processProposalScopes({ ...options, process });
  assert.deepEqual(calls.slice(callsBeforeRetry), [[options.scopes[1].scopeId, 'evaluate', 1]]);
  assert.deepEqual(
    result.proposed.map((item) => item.values.E.value),
    ['Glove', 'Helmet'],
  );
});

test('canceled or stale work cannot return staged records', async () => {
  for (const message of ['AI processing canceled.', 'Review changed.']) {
    const options = fixture();
    const original = structuredClone(options.baseline);
    let current = true;
    await assert.rejects(
      processProposalScopes({
        ...options,
        check: () => {
          if (!current) throw Error(message);
        },
        process: async (scope) => {
          current = false;
          return response(scope);
        },
      }),
      (error) => error.message === message,
    );
    assert.deepEqual(options.baseline, original);
  }
});

test('nonretryable failures and empty scopes retain their existing error behavior', async () => {
  const options = fixture();
  const failure = Object.assign(Error('Invalid evidence'), { status: 400 });
  await assert.rejects(
    processProposalScopes({
      ...options,
      process: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(options.scopes.length, 1);
  await assert.rejects(
    processProposalScopes({ ...options, scopes: [] }),
    /Map items or choose source rows first/,
  );
});
