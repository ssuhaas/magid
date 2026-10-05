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

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function individualScopes(options) {
  options.scopes = options.baseline.map(record => buildScope(options.book, [record], {
    digest: options.sourceDigest, scopeId: options.createScopeId(),
  }));
  return options;
}

test('two groups overlap, but out-of-order completion preserves source order and values', async () => {
  const options = individualScopes(fixture());
  const first = deferred(), bothStarted = deferred();
  let active = 0, peak = 0, starts = 0;
  const run = processProposalScopes({ ...options, concurrency: 2, process: async scope => {
    active++;
    peak = Math.max(peak, active);
    if (++starts === 2) bothStarted.resolve();
    if (scope.records[0].anchors[0] === 'A1') await first.promise;
    active--;
    return response(scope);
  }});
  await bothStarted.promise;
  first.resolve();
  const result = await run;
  assert.equal(peak, 2);
  assert.deepEqual(result.proposed.map(r => r.values.E.value), ['Glove', 'Helmet']);
  assert.deepEqual(result.evaluations.map(e => e.items[0].anchors), [['A1'], ['A2']]);
});

test('a failed group aborts its sibling and returns no partial results or late progress', async () => {
  const options = individualScopes(fixture());
  const siblingStarted = deferred(), fail = deferred();
  const messages = [];
  let canceled = false;
  const original = structuredClone(options.baseline);
  const run = processProposalScopes({ ...options, progress: m => messages.push(m), process: async (scope, controls) => {
    if (scope.records[0].anchors[0] === 'A1') {
      await fail.promise;
      throw Error('Provider failed');
    }
    siblingStarted.resolve();
    await new Promise(resolve => controls.signal.addEventListener('abort', () => {
      canceled = true;
      resolve();
    }, { once: true }));
    controls.progress('waiting', 'will resume');
    return response(scope);
  }});
  await siblingStarted.promise;
  fail.resolve();
  await assert.rejects(run, /Provider failed/);
  assert.equal(canceled, true);
  assert.deepEqual(options.baseline, original);
  assert.ok(!messages.some(m => m.includes('will resume')));
});

test('serial fallback is supported; concurrent timeout splits retain targeted masks', async () => {
  const options = fixture();
  options.scopes = [buildScope(options.book, options.baseline, {
    digest: options.sourceDigest, scopeId: 'target', targeted: true,
  })];
  const seen = [];
  await processProposalScopes({ ...options, concurrency: 1, process: async scope => {
    if (scope.records.length > 1) throw Object.assign(Error('Too large'), { status: 413 });
    seen.push(scope.records[0].requestedColumns);
    return response(scope);
  }});
  assert.equal(seen.length, 2);
  assert.ok(seen.every(columns => columns.includes('E')));
});
