import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestSlots } from '../lib/ai/request-slots.mjs';

test('two requests per user and four per isolate leave capacity for another user', () => {
  const slots = createRequestSlots();
  const a = slots.acquire('a', 0), b = slots.acquire('a', 0);
  assert.ok(a.lease && b.lease);
  assert.equal(slots.acquire('a', 0).code, 'SESSION_BUSY');
  assert.ok(slots.acquire('b', 0).lease);
  assert.ok(slots.acquire('b', 0).lease);
  assert.equal(slots.acquire('c', 0).code, 'SESSION_BUSY');
  slots.release(a.lease);
  slots.release(a.lease);
  assert.ok(slots.acquire('c', 0).lease);
});

test('expired leases abort; release cannot delete a replacement; waiting does not consume rate', () => {
  const slots = createRequestSlots({ perUser: 1, rateLimit: 2 });
  const old = slots.acquire('a', 0).lease;
  assert.equal(slots.acquire('a', 1).code, 'SESSION_BUSY');
  const next = slots.acquire('a', 27000).lease;
  assert.equal(old.abort.signal.aborted, true);
  slots.release(old);
  assert.equal(slots.acquire('a', 27001).code, 'REQUEST_RATE_LIMIT');
  slots.release(next);
  assert.equal(slots.acquire('a', 27002).retryAfter, 33);
  assert.ok(slots.acquire('a', 60000).lease);
});
