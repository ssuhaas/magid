import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from './helpers/fixtures.mjs';
import { readWorkbook, extract } from '../lib/workbook.mjs';
import { prepareDescriptions } from '../lib/description-policy.mjs';
import { buildScope } from '../lib/ai/client.mjs';
import { processProposalScopes } from '../lib/ai/process-proposal.mjs';
import { finalReadiness } from '../lib/canonical/export.mjs';
import { reviewStats } from '../lib/ui/review.mjs';
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

const samples = [
  ['Daikin', '8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx', 338],
  ['Hyundai', 'a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx', 35],
  ['Tesla', 'e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx', 476],
  ['Grainger', 'fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx', 31],
  ['Berry', '5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx', 76],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const templateDigest = hash(readFileSync('public/template.xlsx'));

for (const maxItems of [3, 6])
  for (const [name, path, count] of samples)
    test(`${name} (max ${maxItems}): runner preserves records, proofs, review counts and final blockers`, async () => {
      const bytes = readFileSync('../attachments/' + path),
        book = readWorkbook(bytes);
      const items = prepareDescriptions(extract(book).records, book),
        original = structuredClone(items);
      const current = controller(),
        prior = controller(),
        columns = {};
      const baseline = prepareNormalization(book, items, current, columns);
      const oldBaseline = legacyPrepare(book, items, prior, columns);
      assert.deepEqual(baseline, oldBaseline);
      const sourceDigest = hash(bytes),
        common = {
          book,
          sourceDigest,
          signal: new AbortController().signal,
          check: () => {},
          observer: () => {},
          progress: () => {},
          // Controlled boundary disagreement exercises exception routing without AI guesses.
          process: async (scope) => response(scope, 'review'),
        };
      const oldScopes = Array.from({ length: Math.ceil(oldBaseline.length / 3) }, (_, i) =>
        buildScope(book, oldBaseline.slice(i * 3, i * 3 + 3), {
          digest: sourceDigest,
          scopeId: `old-${i}`,
          targeted: true,
        }),
      );
      const oldResult = await processProposalScopes({
        ...common,
        baseline: oldBaseline,
        scopes: oldScopes,
        cache: new Map(),
      });
      const result = await runNormalization({
        ...common,
        maxItems,
        baseline,
        sessionCache: createNormalizationCache(),
        generation: 1,
        revision: 0,
        discover: false,
        selection: { sheet: book.sheets[0].name, start: '1', end: '2' },
      });
      const records = finalizeNormalization({
        book,
        baseline,
        result,
        controller: current,
        columns,
        check: common.check,
      });
      const oldRecords = legacyFinalize(book, oldBaseline, oldResult, prior, columns);
      assert.equal(records.length, count);
      assert.deepEqual(records, oldRecords);
      assert.deepEqual(items, original);
      assert.deepEqual(controllerState(current), controllerState(prior));
      assert.deepEqual(
        reviewStats(records, columns, current, book),
        reviewStats(oldRecords, columns, prior, book),
      );
      const args = {
        book,
        columns,
        name,
        digest: sourceDigest,
        templateDigest,
        coverageConfirmed: false,
      };
      const ready = finalReadiness({ ...args, records, controller: current });
      const before = finalReadiness({ ...args, records: oldRecords, controller: prior });
      assert.deepEqual(ready.messages, before.messages);
      assert.deepEqual(
        ready.issues.map((i) => [i.code, i.path]),
        before.issues.map((i) => [i.code, i.path]),
      );
      assert.ok(ready.messages.length, 'unresolved source checks still block export');
    });
