import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, extract } from '../lib/workbook.mjs';
import { processStages } from '../lib/ai/stages.mjs';
import {
  createNormalizationCache,
  prepareNormalization,
  runNormalization,
  finalizeNormalization,
} from '../lib/ai/normalize-proposal.mjs';
import {
  controller,
  controllerState,
  legacyPrepare,
  legacyFinalize,
  response,
} from './helpers/normalization.mjs';

function fixture(count = 7) {
  const sheet = {
    name: 'Bid',
    hidden: 'visible',
    hiddenRows: [],
    cells: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `A${i + 1}`,
        { raw: `Glove ${i + 1}`, type: 's', formula: null },
      ]),
    ),
  };
  const book = { sheets: [sheet], population: count };
  const items = Object.keys(sheet.cells).map((a) => makeRecord(sheet, [a]));
  const review = controller();
  let ids = 0;
  return {
    book,
    items,
    controller: review,
    columns: {},
    baseline: prepareNormalization(book, items, review, {}),
    sourceDigest: 'a'.repeat(64),
    generation: 1,
    revision: 0,
    discover: false,
    selection: { sheet: 'Bid', start: '1', end: String(count) },
    sessionCache: createNormalizationCache(),
    createScopeId: () => `scope-${++ids}`,
    check: () => {},
    signal: new AbortController().signal,
    observer: () => {},
    progress: () => {},
    process: async (scope) => response(scope),
  };
}

test('preparation and finalization preserve previous page decisions without mutating input items', async () => {
  const f = fixture(),
    original = structuredClone(f.items),
    prior = controller();
  const before = legacyPrepare(f.book, f.items, prior, f.columns);
  assert.deepEqual(f.baseline, before);
  assert.deepEqual(controllerState(f.controller), controllerState(prior));
  const result = await runNormalization(f);
  assert.equal(
    f.controller.evaluationComplete,
    false,
    'staged output grants no evaluation approval',
  );
  const expected = legacyFinalize(f.book, before, structuredClone(result), prior, f.columns);
  assert.deepEqual(finalizeNormalization({ ...f, result }), expected);
  assert.deepEqual(controllerState(f.controller), controllerState(prior));
  assert.deepEqual(f.items, original);
});

test('three-item targeted groups, diagnostics and unchanged retry scopes remain stable', async () => {
  const f = fixture(),
    events = [];
  await runNormalization({ ...f, observer: (e) => events.push(e) });
  const plan = f.sessionCache.plan;
  assert.deepEqual(
    plan.scopes.map((s) => s.records.length),
    [3, 3, 1],
  );
  assert.ok(plan.scopes.every((s) => s.records.every((r) => Array.isArray(r.requestedColumns))));
  assert.equal(events[0].detail.groups, 3);
  assert.equal(events[0].detail.items, 7);
  f.sessionCache.stages.set('sentinel', { scope: plan.scopes[0] });
  await runNormalization(f);
  assert.equal(f.sessionCache.plan, plan);
  assert.ok(f.sessionCache.stages.has('sentinel'));
});

test('explicit reviewer blanks remain protected through planning and finalization', async () => {
  const f = fixture(1),
    before = structuredClone(f.items[0]);
  f.items[0].values.H.status = 'blank';
  f.items[0].values.H.reason = 'Reviewer deliberately leaves manufacturer blank.';
  f.controller.record(before, f.items[0], 'Leave unsupported manufacturer blank.');
  const proofs = [...f.controller.fields];
  f.baseline = prepareNormalization(f.book, f.items, f.controller, f.columns);
  const result = await runNormalization(f);
  assert.ok(!f.sessionCache.plan.scopes[0].records[0].requestedColumns.includes('H'));
  const records = finalizeNormalization({ ...f, result });
  assert.equal(records[0].values.H.status, 'blank');
  assert.deepEqual([...f.controller.fields], proofs);
});

test('changed source, generation, review revision, selection or baseline values invalidates the retry cache', async () => {
  const variations = [
    { maxItems: 6 },
    { generation: 2 },
    { revision: 1 },
    { sourceDigest: 'b'.repeat(64) },
    { selection: { sheet: 'Other', start: '1', end: '7' } },
    { selection: { sheet: 'Bid', start: '01', end: '7' } },
    { selection: { sheet: 'Bid', start: '1', end: '8' } },
  ];
  for (const change of [...variations, 'value']) {
    const f = fixture();
    await runNormalization(f);
    const old = f.sessionCache.plan;
    f.sessionCache.stages.set('sentinel', { scope: old.scopes[0] });
    if (change === 'value') f.baseline[0].values.H.value = 'changed';
    await runNormalization({ ...f, ...(change === 'value' ? {} : change) });
    assert.notEqual(f.sessionCache.plan, old);
    assert.equal(f.sessionCache.stages.has('sentinel'), false);
  }
});

test('failed split groups retain completed stages and resume only the unfinished evaluation', async () => {
  const f = fixture(2),
    calls = [];
  let fail = true;
  const process = (scope, options) =>
    processStages(scope, {
      ...options,
      send: async (stage) => {
        calls.push([scope.scopeId, stage]);
        if (scope.records.length > 1) throw Object.assign(Error('Timed out'), { status: 504 });
        if (scope.records[0].anchors[0] === 'A2' && stage === 'evaluate' && fail) {
          fail = false;
          throw Error('Evaluation failed');
        }
        return response(scope);
      },
    });
  await assert.rejects(runNormalization({ ...f, process }), /Evaluation failed/);
  assert.deepEqual(
    f.sessionCache.plan.scopes.map((s) => s.records.length),
    [1, 1],
  );
  assert.equal(f.controller.evaluationComplete, false);
  const marker = calls.length;
  await runNormalization({ ...f, process });
  assert.deepEqual(calls.slice(marker), [[f.sessionCache.plan.scopes[1].scopeId, 'evaluate']]);
});

test('staleness or cancellation after staging cannot change controller proofs or candidates', async () => {
  for (const message of ['Source replaced.', 'AI processing canceled.']) {
    const f = fixture(),
      result = await runNormalization(f);
    const before = controllerState(f.controller),
      records = structuredClone(result.proposed);
    assert.throws(
      () =>
        finalizeNormalization({
          ...f,
          result,
          check: () => {
            throw Error(message);
          },
        }),
      new RegExp(message),
    );
    assert.deepEqual(controllerState(f.controller), before);
    assert.deepEqual(result.proposed, records);
  }
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(runNormalization({ ...f, signal: abort.signal }), /canceled/);
  assert.equal(f.controller.evaluationComplete, false);
});

test('discovery still uses the selected source region and validates row bounds', async () => {
  const f = fixture(2);
  const result = await runNormalization({ ...f, baseline: [], discover: true });
  assert.equal(f.sessionCache.plan.scopes[0].mode, 'discover');
  assert.equal(result.proposed.length, 1);
  assert.deepEqual(result.proposed[0].anchors, ['A1']);
  await assert.rejects(
    runNormalization({
      ...fixture(),
      discover: true,
      selection: { sheet: 'Bid', start: '2', end: '1' },
    }),
    /source rows/,
  );
});

test('run timing aggregates stage requests across groups and remains separate from candidate authority', async () => {
  const f = fixture(4),
    events = [];
  const result = await runNormalization({
    ...f,
    observer: (e) => events.push(e),
    process: async (scope, options) => {
      for (const stage of ['extract', 'evaluate'])
        options.observer({
          stage: 'ai',
          status: 'timed',
          message: 'Controlled timing',
          detail: { stage, outcome: 'completed', milliseconds: 10 },
        });
      return response(scope);
    },
  });
  const summary = events.at(-1);
  assert.equal(summary.status, 'measured');
  assert.equal(summary.detail.extractionRequests, 2);
  assert.equal(summary.detail.evaluationRequests, 2);
  assert.equal(summary.detail.requestMilliseconds, 40);
  assert.equal(summary.detail.failedRequests, 0);
  assert.equal(summary.detail.outcome, 'completed');
  assert.equal(f.controller.evaluationComplete, false);
  assert.equal(result.proposed.length, 4);
  const failed = [];
  await assert.rejects(
    runNormalization({
      ...fixture(1),
      observer: (e) => failed.push(e),
      process: async () => {
        throw Error('Provider failed');
      },
    }),
    /Provider failed/,
  );
  assert.equal(failed.at(-1).detail.outcome, 'failed');
});

function stockFixture() {
  const f = fixture(0);
  const s = f.book.sheets[0];
  for (const [address, raw] of Object.entries({
    A1: 'Item', B1: 'Part #', D1: 'Item', E1: 'Part #', G1: 'Item', H1: 'Part #',
    A3: 'Goggles', B4: '001AB', E4: '02CD',
  })) s.cells[address] = { raw, type: 's', formula: null };
  f.book.population = Object.keys(s.cells).length;
  f.items = extract(f.book).records;
  f.baseline = prepareNormalization(f.book, f.items, f.controller, f.columns);
  return f;
}

test('proven closed stock rows skip both AI passes, preserve source values and still stage completion', async () => {
  const f = stockFixture(), events = [];
  const result = await runNormalization({ ...f, observer: e => events.push(e),
    process: async () => { throw Error('No provider calls permitted.'); } });
  assert.deepEqual(result.deterministicSkippedIds, f.baseline.map(r => r.id));
  assert.equal(result.evaluations.length, 0, 'no invented model verdicts');
  assert.deepEqual(result.proposed, f.baseline);
  assert.equal(events[0].detail.providerCallsBeforeRetry, 0);
  assert.equal(events[0].detail.deterministicSkippedItems, 2);
  assert.equal(f.controller.evaluationComplete, false);
  finalizeNormalization({ ...f, result });
  assert.equal(f.controller.evaluationComplete, true);
  assert.equal(f.controller.evaluated.size, 0);
  assert.equal(f.controller.fields.size, 0, 'no fabricated human decisions');
});

test('mixed rows keep descriptions and adjacent codes in AI while skipped occurrences stay untouched', async () => {
  const f = stockFixture();
  f.book.sheets[0].cells.D4 = { raw: 'Gloves size XL, 200 pairs per box', type: 's', formula: null };
  f.items = extract(f.book).records;
  f.baseline = prepareNormalization(f.book, f.items, f.controller, f.columns);
  const scopes = [];
  const result = await runNormalization({ ...f, process: async s => { scopes.push(s); return response(s); } });
  assert.deepEqual(scopes.flatMap(s => s.records.map(r => r.anchors)), [['E4']]);
  assert.deepEqual(result.deterministicSkippedIds, [f.baseline[0].id]);
  assert.deepEqual(result.proposed.find(r => r.id === f.baseline[0].id), f.baseline[0]);
  finalizeNormalization({ ...f, result });
  const forged = { ...result, evaluations: [] };
  assert.throws(() => finalizeNormalization({ ...f, result: forged }), /independent AI check/);
});

test('blank statuses, unfamiliar headings, formulas, hidden source and ambiguous code relationships never prove completeness', async () => {
  for (const mutate of [
    f => f.book.sheets[0].cells.C4 = { raw: 'alternate-002', type: 's', formula: null },
    f => f.book.sheets[0].cells.C4 = { raw: '', type: 's', formula: 'A1' },
    f => f.book.sheets[0].cells.B1.formula = 'A1',
    f => f.book.sheets[0].hiddenRows.push('4'),
    f => f.baseline[0].ambiguous = true,
    f => f.baseline[0].evaluationBoundaryReview = true,
    f => f.baseline[0].values.G.status = 'accepted',
    f => f.baseline[0].values.D.value = 'Acme XL goggles',
    f => f.baseline[0].extras['Source Product ID'].alternatives = [{ ...f.baseline[0].extras['Source Product ID'] }],
    f => f.book.sheets[0].cells.A2 = { raw: 'Quantity', type: 's', formula: null },
  ]) {
    const f = stockFixture(); mutate(f);
    const result = await runNormalization(f);
    assert.ok(!result.deterministicSkippedIds.includes(f.baseline[0].id));
    assert.ok(f.sessionCache.plan.scopes.some(s => s.records.some(r => r.id === f.baseline[0].id)));
  }
  const ordinary = fixture(1);
  const result = await runNormalization(ordinary);
  assert.deepEqual(result.deterministicSkippedIds, [], 'generic narrative auto blanks need AI');
});

test('source or skipped output changes are rejected before any controller completion', async () => {
  for (const mutate of [
    (f, r) => f.book.sheets[0].cells.C4 = { raw: 'size XL', type: 's', formula: null },
    (f, r) => r.proposed[0].extras['Source Product ID'].value = 'invented',
    (f, r) => r.deterministicSkippedIds.push(r.deterministicSkippedIds[0]),
    (f, r) => r.deterministicSkippedIds.push('unknown-row'),
  ]) {
    const f = stockFixture(), result = await runNormalization(f);
    result.proposed = structuredClone(result.proposed);
    mutate(f, result);
    const prior = controllerState(f.controller);
    assert.throws(() => finalizeNormalization({ ...f, result }), /completeness|skip/);
    assert.deepEqual(controllerState(f.controller), prior);
  }
});

test('new unresolved source invalidates an all-skipped retry plan and cancellation still rejects zero-call work', async () => {
  const f = stockFixture();
  await runNormalization(f);
  const old = f.sessionCache.plan;
  f.book.sheets[0].cells.C4 = { raw: 'second-code', type: 's', formula: null };
  await runNormalization(f);
  assert.notEqual(f.sessionCache.plan, old);
  assert.equal(f.sessionCache.plan.scopes.length, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runNormalization({ ...stockFixture(), signal: abort.signal }), /canceled/);
});
