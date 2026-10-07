import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from '../lib/workbook.mjs';
import { processStages } from '../lib/ai/stages.mjs';
import {
  createNormalizationCache, prepareNormalization, runNormalization, finalizeNormalization,
} from '../lib/ai/normalize-proposal.mjs';
import { controller, controllerState, legacyPrepare, legacyFinalize, response } from './helpers/normalization.mjs';

function fixture(count = 7) {
  const sheet = { name: 'Bid', hidden: 'visible', hiddenRows: [], cells: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`A${i + 1}`, { raw: `Glove ${i + 1}`, type: 's', formula: null }]),
  ) };
  const book = { sheets: [sheet], population: count };
  const items = Object.keys(sheet.cells).map(a => makeRecord(sheet, [a]));
  const review = controller();
  let ids = 0;
  return {
    book, items, controller: review, columns: {},
    baseline: prepareNormalization(book, items, review, {}),
    sourceDigest: 'a'.repeat(64), generation: 1, revision: 0, discover: false,
    selection: { sheet: 'Bid', start: '1', end: String(count) },
    sessionCache: createNormalizationCache(), createScopeId: () => `scope-${++ids}`,
    check: () => {}, signal: new AbortController().signal, observer: () => {}, progress: () => {},
    process: async scope => response(scope),
  };
}

test('preparation and finalization preserve previous page decisions without mutating input items', async () => {
  const f = fixture(), original = structuredClone(f.items), prior = controller();
  const before = legacyPrepare(f.book, f.items, prior, f.columns);
  assert.deepEqual(f.baseline, before);
  assert.deepEqual(controllerState(f.controller), controllerState(prior));
  const result = await runNormalization(f);
  assert.equal(f.controller.evaluationComplete, false, 'staged output grants no evaluation approval');
  const expected = legacyFinalize(f.book, before, structuredClone(result), prior, f.columns);
  assert.deepEqual(finalizeNormalization({ ...f, result }), expected);
  assert.deepEqual(controllerState(f.controller), controllerState(prior));
  assert.deepEqual(f.items, original);
});

test('three-item targeted groups, diagnostics and unchanged retry scopes remain stable', async () => {
  const f = fixture(), events = [];
  await runNormalization({ ...f, observer: e => events.push(e) });
  const plan = f.sessionCache.plan;
  assert.deepEqual(plan.scopes.map(s => s.records.length), [3, 3, 1]);
  assert.ok(plan.scopes.every(s => s.records.every(r => Array.isArray(r.requestedColumns))));
  assert.equal(events[0].detail.groups, 3);
  assert.equal(events[0].detail.items, 7);
  f.sessionCache.stages.set('sentinel', { scope: plan.scopes[0] });
  await runNormalization(f);
  assert.equal(f.sessionCache.plan, plan);
  assert.ok(f.sessionCache.stages.has('sentinel'));
});

test('explicit reviewer blanks remain protected through planning and finalization', async () => {
  const f = fixture(1), before = structuredClone(f.items[0]);
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
    { generation: 2 }, { revision: 1 }, { sourceDigest: 'b'.repeat(64) },
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
  const f = fixture(2), calls = [];
  let fail = true;
  const process = (scope, options) => processStages(scope, { ...options, send: async stage => {
    calls.push([scope.scopeId, stage]);
    if (scope.records.length > 1) throw Object.assign(Error('Timed out'), { status: 504 });
    if (scope.records[0].anchors[0] === 'A2' && stage === 'evaluate' && fail) {
      fail = false;
      throw Error('Evaluation failed');
    }
    return response(scope);
  } });
  await assert.rejects(runNormalization({ ...f, process }), /Evaluation failed/);
  assert.deepEqual(f.sessionCache.plan.scopes.map(s => s.records.length), [1, 1]);
  assert.equal(f.controller.evaluationComplete, false);
  const marker = calls.length;
  await runNormalization({ ...f, process });
  assert.deepEqual(calls.slice(marker), [[f.sessionCache.plan.scopes[1].scopeId, 'evaluate']]);
});

test('staleness or cancellation after staging cannot change controller proofs or candidates', async () => {
  for (const message of ['Source replaced.', 'AI processing canceled.']) {
    const f = fixture(), result = await runNormalization(f);
    const before = controllerState(f.controller), records = structuredClone(result.proposed);
    assert.throws(() => finalizeNormalization({ ...f, result, check: () => { throw Error(message); } }), new RegExp(message));
    assert.deepEqual(controllerState(f.controller), before);
    assert.deepEqual(result.proposed, records);
  }
  const f = fixture(), abort = new AbortController();
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
  await assert.rejects(runNormalization({ ...fixture(), discover: true, selection: { sheet: 'Bid', start: '2', end: '1' } }), /source rows/);
});
