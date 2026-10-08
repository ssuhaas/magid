import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, colName } from '../lib/workbook.mjs';
import { buildScope } from '../lib/ai/client.mjs';
import { planEnrichmentScopes, scopeMaxItems, scopeWork } from '../lib/ai/scope-planner.mjs';
import { requestStage } from '../lib/ai/stages.mjs';

function fixture(count = 13, lowWork = false) {
  const sheet = { name: 'Bid', hidden: 'visible', hiddenRows: [], cells: {} };
  for (let i = 1; i <= count; i++)
    sheet.cells[`A${i}`] = { raw: `Glove ${i}`, type: 's', formula: null };
  const book = { sheets: [sheet], population: count };
  const records = Object.keys(sheet.cells).map((a) => makeRecord(sheet, [a]));
  if (lowWork)
    for (const r of records) {
      for (const [k, f] of Object.entries(r.values)) if (k !== 'H') f.status = 'blank';
    }
  let ids = 0;
  const options = { digest: 'a'.repeat(64), createScopeId: () => `scope-${++ids}` };
  return { book, records, options };
}

test('default configuration retains exact three-item scopes and rejects invalid opt-in values', () => {
  for (const v of [undefined, null, 2, 7, 3.5, '6', NaN]) assert.equal(scopeMaxItems(v), 3);
  for (const v of [3, 4, 5, 6]) assert.equal(scopeMaxItems(v), v);
  const f = fixture();
  const scopes = planEnrichmentScopes(f.book, f.records, f.options);
  assert.deepEqual(
    scopes,
    Array.from({ length: 5 }, (_, i) =>
      buildScope(f.book, f.records.slice(i * 3, i * 3 + 3), {
        digest: f.options.digest,
        scopeId: `scope-${i + 1}`,
        targeted: true,
      }),
    ),
  );
});

test('larger scopes reduce calls for low unresolved work, retaining every field mask, occurrence and source cell', () => {
  const f = fixture(13, true),
    before = structuredClone(f.records);
  const scopes = planEnrichmentScopes(f.book, f.records, { ...f.options, maxItems: 6 });
  assert.deepEqual(
    scopes.map((s) => s.records.length),
    [6, 6, 1],
  );
  assert.deepEqual(
    scopes.flatMap((s) => s.records.map((r) => r.id)),
    f.records.map((r) => r.id),
  );
  for (const scope of scopes)
    for (const r of scope.records) {
      const single = buildScope(
        f.book,
        f.records.filter((x) => x.id === r.id),
        { digest: f.options.digest, scopeId: 'single', targeted: true },
      );
      assert.deepEqual(r, single.records[0]);
      for (const c of single.cells)
        assert.ok(
          scope.cells.some(
            (x) =>
              x.sheet === c.sheet &&
              x.cell === c.cell &&
              x.raw === c.raw &&
              x.formula === c.formula,
          ),
        );
    }
  assert.deepEqual(f.records, before);
  const work = scopeWork(scopes);
  assert.equal(work.requestedFields, 13);
  assert.equal(work.providerCallsBeforeRetry, 6);
  assert.ok(work.sourcePayloadBytes >= work.largestSourcePayloadBytes);
});

test('fully unresolved work stays at three items and larger plans respect section and payload bounds', () => {
  const f = fixture(7);
  assert.deepEqual(
    planEnrichmentScopes(f.book, f.records, { ...f.options, maxItems: 6 }).map(
      (s) => s.records.length,
    ),
    [3, 3, 1],
  );
  const low = fixture(4, true);
  low.records[2].section = low.records[3].section = 'Other section';
  assert.deepEqual(
    planEnrichmentScopes(low.book, low.records, { ...low.options, maxItems: 6 }).map(
      (s) => s.records.length,
    ),
    [2, 2],
  );
  const mixed = fixture(4, true);
  mixed.book.sheets.push({ ...mixed.book.sheets[0], name: 'Other' });
  mixed.records[2].sheet = mixed.records[3].sheet = 'Other';
  assert.deepEqual(
    planEnrichmentScopes(mixed.book, mixed.records, { ...mixed.options, maxItems: 6 }).map(
      (s) => s.records.length,
    ),
    [2, 2],
  );
  const crowded = fixture(2, true);
  for (const row of [1, 2])
    for (let i = 0; i < 600; i++)
      crowded.book.sheets[0].cells[`${colName(i + 2)}${row}`] = {
        raw: 'Data',
        type: 's',
        formula: null,
      };
  const bounded = planEnrichmentScopes(crowded.book, crowded.records, {
    ...crowded.options,
    maxItems: 6,
  });
  assert.deepEqual(
    bounded.map((s) => s.records.length),
    [1, 1],
  );
  assert.ok(bounded.every((s) => s.cells.length === 601));
  const large = fixture(3, true);
  for (const c of Object.values(large.book.sheets[0].cells)) c.raw = 'x'.repeat(32000);
  assert.deepEqual(
    planEnrichmentScopes(large.book, large.records, { ...large.options, maxItems: 6 }).map(
      (s) => s.records.length,
    ),
    [1, 1, 1],
  );
  const tooLarge = fixture(1);
  for (let i = 0; i < 950; i++)
    tooLarge.book.sheets[0].cells[`${colName(i + 2)}1`] = {
      raw: 'Manufacturer Part Number',
      type: 's',
      formula: null,
    };
  assert.throws(
    () =>
      planEnrichmentScopes(tooLarge.book, tooLarge.records, { ...tooLarge.options, maxItems: 6 }),
    /source scope is too large/,
  );
});

test('timings report stage outcomes without source values and observer failures cannot change success', async () => {
  const f = fixture(1),
    input = planEnrichmentScopes(f.book, f.records, f.options)[0];
  const events = [];
  const result = {
    digest: input.digest,
    scopeId: input.scopeId,
    proposal: { items: [], warnings: [] },
  };
  await requestStage('extract', input, {
    observer: (e) => events.push(e),
    fetchImpl: async () => Response.json(result),
  });
  assert.equal(events.at(-1).detail.outcome, 'completed');
  assert.ok(events.at(-1).detail.milliseconds >= 0);
  assert.ok(!JSON.stringify(events).includes('Glove'));
  assert.deepEqual(
    await requestStage('extract', input, {
      observer: () => {
        throw Error('Broken observer');
      },
      fetchImpl: async () => Response.json(result),
    }),
    result,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    requestStage('extract', input, {
      signal: abort.signal,
      observer: (e) => events.push(e),
      fetchImpl: async () => {
        throw Error('Canceled');
      },
    }),
    /canceled/,
  );
  assert.equal(events.at(-1).detail.outcome, 'canceled');
});
