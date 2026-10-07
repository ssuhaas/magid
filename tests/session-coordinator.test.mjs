import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCoordinator } from '../lib/session/coordinator.mjs';
import { parseWorkbookInWorker } from '../lib/session/parse-workbook.mjs';
import { makeRecord } from '../lib/workbook.mjs';
import { processStages } from '../lib/ai/stages.mjs';
import { prepareNormalization, runNormalization } from '../lib/ai/normalize-proposal.mjs';
import { controller, controllerState, response } from './helpers/normalization.mjs';
import { captureDecision, capturePipeline, assertCurrentPipeline } from '../lib/canonical/decisions.mjs';

function fixture() {
  let time = 0;
  const revoked = [];
  const session = createSessionCoordinator({ now: () => time, revokeURL: url => revoked.push(url) });
  const bytes = new Uint8Array([1, 2, 3]);
  session.acceptSource(session.generation, bytes, 'a'.repeat(64));
  return { session, bytes, revoked, time: value => { time = value; } };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
class FakeWorker {
  terminated = 0;
  onmessage = null;
  onerror = null;
  messages = [];
  terminate() { this.terminated++; }
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.onmessage?.({ data }); }
}
function parse(session, worker, extra = {}) {
  return parseWorkbookInWorker({
    session, generation: session.generation, bytes: new Uint8Array([1]), filename: 'bid.xlsx',
    debug: true, createWorker: () => worker, progress: () => {}, ...extra,
  });
}

test('replacement upload rejects a late source hash without changing the new bytes or digest', async () => {
  const { session } = fixture(), old = session.generation, hash = deferred();
  const late = hash.promise.then(digest => session.acceptSource(old, new Uint8Array([9]), digest));
  session.reset();
  const current = new Uint8Array([4]);
  assert.equal(session.acceptSource(session.generation, current, 'b'.repeat(64)), true);
  hash.resolve('c'.repeat(64));
  assert.equal(await late, false);
  assert.equal(session.sourceBytes, current);
  assert.equal(session.sourceDigest, 'b'.repeat(64));
});

test('canceling queued AI keeps retry stages and cannot unlock a replacement operation', () => {
  const { session } = fixture();
  session.cache.stages.set('completed', { scope: {} });
  const abort = session.beginAI('first');
  assert.equal(session.beginExport(), false);
  assert.equal(session.beginAI('overlap'), null);
  session.cancelAI();
  assert.equal(abort.signal.aborted, true);
  assert.ok(session.cache.stages.has('completed'));
  assert.equal(session.operation, 'first');
  assert.equal(session.finishAI('first'), true);
  assert.equal(session.beginAI('retry').signal.aborted, false);
  session.reset();
  session.beginAI('replacement');
  assert.equal(session.finishAI('retry'), false);
  assert.equal(session.operation, 'replacement');
  session.dispose();
});

test('old export cleanup cannot release a new proposal operation', () => {
  const { session } = fixture(), old = session.generation;
  assert.equal(session.beginExport(), true);
  session.reset();
  assert.equal(session.beginExport(), true);
  assert.equal(session.finishExport(old), false);
  assert.equal(session.operation, 'export');
  assert.equal(session.finishExport(session.generation), true);
});

test('review changes revoke prepared downloads and invalidate both decision and pipeline ownership', () => {
  const { session, revoked } = fixture();
  const decision = captureDecision(session.decisionState(4));
  const abort = session.beginAI('run');
  const token = capturePipeline({ ...session.decisionState(4), runId: session.operation });
  session.publishDownload(decision, 4, () => 'blob:old');
  session.reviewChanged();
  assert.deepEqual(revoked, ['blob:old']);
  assert.throws(() => assertCurrentPipeline(token, { ...session.decisionState(5), runId: session.operation }), /decisions changed/);
  assert.equal(abort.signal.aborted, false, 'the existing stale guard remains responsible for stopping AI');
  assert.throws(() => session.publishDownload(decision, 5, () => 'blob:stale'), /decisions changed/);
  session.dispose();
});

test('a stale final export return cannot create a URL after review, controller, or source changes', () => {
  for (const change of ['review', 'controller', 'source']) {
    const { session } = fixture();
    const token = captureDecision(session.decisionState(2));
    let creates = 0, revision = 2;
    if (change === 'review') session.reviewChanged();
    if (change === 'controller') revision++;
    if (change === 'source') session.reset();
    assert.throws(() => session.publishDownload(token, revision, () => { creates++; return 'blob:late'; }), /decisions changed/);
    assert.equal(creates, 0);
  }
});

test('download replacement and reset revoke each owned URL exactly once', () => {
  const { session, revoked } = fixture(), token = captureDecision(session.decisionState(1));
  session.publishDownload(token, 1, () => 'blob:first');
  assert.throws(() => session.publishDownload(token, 1, () => { throw Error('URL failure'); }), /URL failure/);
  assert.deepEqual(revoked, []);
  session.publishDownload(token, 1, () => 'blob:second');
  session.reset();
  session.invalidateDownload();
  assert.deepEqual(revoked, ['blob:first', 'blob:second']);
  assert.equal(session.sourceBytes, null);
  assert.equal(session.sourceDigest, '');
  assert.equal(session.cache.stages.size, 0);
  assert.equal(session.cache.plan, null);
});

test('idle, absolute and download-grace limits preserve their existing strict boundaries', () => {
  const f = fixture();
  f.time(3600000);
  assert.equal(f.session.lifetime().expired, false);
  f.time(3600001);
  assert.equal(f.session.lifetime().expired, true);
  f.session.touch();
  assert.equal(f.session.lifetime().expired, false);
  f.time(28500000); f.session.touch();
  assert.equal(f.session.lifetime().absoluteWarning, true);
  f.time(28800000); f.session.continueReview();
  assert.equal(f.session.lifetime().expired, false);
  f.time(28800001); f.session.continueReview();
  assert.equal(f.session.lifetime().expired, true, 'continuing review never resets birth time');
  const grace = fixture();
  grace.session.downloadRequested();
  grace.time(900000);
  assert.equal(grace.session.lifetime().expired, false);
  grace.time(900001);
  assert.equal(grace.session.lifetime().expired, true);
  grace.session.continueReview();
  assert.equal(grace.session.lifetime().expired, false);
});

test('parser forwards current progress and cleans up once after success or worker failure', async () => {
  const { session } = fixture(), worker = new FakeWorker(), events = [];
  const pending = parse(session, worker, { progress: event => events.push(event) });
  worker.emit({ progress: { stage: 'parse', status: 'running', message: 'Reading' } });
  const result = { workbook: { sheets: [] }, result: { records: [] } };
  worker.emit(result);
  assert.equal(await pending, result);
  assert.equal(events.length, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.messages[0].filename, 'bid.xlsx');
  worker.emit(result);
  assert.equal(worker.terminated, 1);
  const failed = new FakeWorker(), failing = parse(session, failed);
  failed.onerror();
  await assert.rejects(failing, /worker failed/);
  assert.equal(failed.terminated, 1);
});

test('replacement and page close reject old parser work without releasing the new worker', async () => {
  const { session } = fixture(), old = new FakeWorker();
  const oldPending = assert.rejects(parse(session, old), /Processing canceled/);
  session.reset();
  const current = new FakeWorker(), currentPending = assert.rejects(parse(session, current), /Page closed/);
  old.emit({ workbook: {}, result: {} });
  assert.equal(current.terminated, 0);
  session.dispose();
  await Promise.all([oldPending, currentPending]);
  assert.equal(old.terminated, 1);
  assert.equal(current.terminated, 1);
  assert.equal(session.sourceBytes, null);
});

test('parser timeout and transport exceptions release temporary resources', async () => {
  const { session } = fixture(), timeout = new FakeWorker();
  await assert.rejects(parse(session, timeout, { timeoutMs: 0 }), /timed out after 60 seconds/);
  assert.equal(timeout.terminated, 1);
  const broken = new FakeWorker();
  broken.postMessage = () => { throw Error('Transport failed'); };
  await assert.rejects(parse(session, broken), /Transport failed/);
  assert.equal(broken.terminated, 1);
});

function aiRun(session, runId, process, progress = () => {}) {
  const book = { population: 1, sheets: [{ name: 'Bid', hidden: 'visible', hiddenRows: [], cells: {
    A1: { raw: 'Glove', type: 's', formula: null },
  } }] };
  const review = controller();
  const baseline = prepareNormalization(book, [makeRecord(book.sheets[0], ['A1'])], review, {});
  const abort = session.beginAI(runId);
  const token = capturePipeline({ ...session.decisionState(review.revision), runId });
  const check = () => {
    if (abort.signal.aborted) throw Error('AI processing canceled.');
    assertCurrentPipeline(token, { ...session.decisionState(review.revision), runId: session.operation });
  };
  return {
    review,
    promise: runNormalization({
      book, baseline, sourceDigest: session.sourceDigest, sessionCache: session.cache,
      generation: session.generation, revision: session.reviewRevision, discover: false,
      selection: { sheet: 'Bid', start: '1', end: '1' }, check, signal: abort.signal,
      observer: () => {}, progress, process,
    }),
  };
}

test('canceling an actual busy-stage wait stops progress and leaves the session available for retry', async () => {
  const { session } = fixture(), waiting = deferred(), messages = [];
  const running = aiRun(session, 'queued', (scope, options) => processStages(scope, {
    ...options, send: async () => { throw Object.assign(Error('Waiting for provider'), { code: 'SERVICE_BUSY', retryAfter: 60 }); },
  }), message => { messages.push(message); if (message.includes('Waiting for provider')) waiting.resolve(); });
  const stopped = assert.rejects(running.promise, /canceled/);
  await waiting.promise;
  const count = messages.length;
  session.cancelAI();
  await stopped;
  assert.equal(messages.length, count, 'no late waiting/progress update after cancellation');
  assert.equal(running.review.evaluationComplete, false);
  assert.equal(session.finishAI('queued'), true);
  const retry = aiRun(session, 'retry', (scope, options) => processStages(scope, {
    ...options, send: async () => response(scope),
  }));
  assert.equal((await retry.promise).proposed.length, 1);
  assert.equal(session.finishAI('retry'), true);
  session.dispose();
});

test('replacement during actual AI staging discards old work and cannot unlock the new AI owner', async () => {
  const { session } = fixture(), gate = deferred();
  const old = aiRun(session, 'old', async scope => { await gate.promise; return response(scope); });
  const before = controllerState(old.review);
  const rejected = assert.rejects(old.promise, /canceled|decisions changed/);
  session.reset();
  session.acceptSource(session.generation, new Uint8Array([8]), 'b'.repeat(64));
  const current = session.beginAI('new');
  gate.resolve();
  await rejected;
  assert.deepEqual(controllerState(old.review), before);
  assert.equal(session.finishAI('old'), false);
  assert.equal(session.operation, 'new');
  assert.equal(current.signal.aborted, false);
  session.dispose();
});
