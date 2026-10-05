import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readWorkbook, extract } from '../lib/workbook.mjs';
import { createReviewController } from '../lib/canonical/bridge.mjs';
import { prepareDescriptions } from '../lib/description-policy.mjs';
import { automateBoundaries, automateCoverage, pruneRedundantExtras } from '../lib/canonical/pipeline.mjs';
import { buildScope } from '../lib/ai/client.mjs';

// Private fixtures stay outside Git; use the same root as the verification setup.
const root = resolve(process.argv[2] || process.env.MAGID_FIXTURE_ROOT || 'tests/fixtures');
const cases = [
  ['Daikin', '8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx'],
  ['Hyundai', 'a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx'],
  ['Tesla', 'e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx'],
  ['Grainger', 'fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx'],
  ['Berry Global', '5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx'],
];
const results = cases.map(([name, path]) => {
  const bytes = readFileSync(resolve(root, 'attachments', path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  const book = readWorkbook(bytes), records = extract(book).records;
  prepareDescriptions(records, book);
  pruneRedundantExtras(records);
  const controller = createReviewController();
  automateBoundaries(controller, records, book);
  controller.automate(records, book);
  automateCoverage(controller, book, records, {});
  let requested = 0, protectedFields = 0, sourceCells = 0;
  const groups = Math.ceil(records.length / 3);
  for (let i = 0; i < groups; i++) {
    const scope = buildScope(book, records.slice(i * 3, i * 3 + 3), { digest, scopeId: `measure-${i}`, targeted: true });
    sourceCells += scope.cells.length;
    requested += scope.records.reduce((n, r) => n + r.requestedColumns.length, 0);
    protectedFields += scope.records.reduce((n, r) => n + 12 - r.requestedColumns.length, 0);
  }
  return { name, digest, items: records.length, groups, providerCallsBeforeRetry: groups * 2,
    previousFieldTargets: records.length * 12, requestedFieldTargets: requested, protectedFields,
    targetReductionPercent: Math.round(protectedFields / (records.length * 12) * 1000) / 10,
    sourceCellsWithRepeatedContext: sourceCells };
});
console.log(JSON.stringify({ scope: 'Offline deterministic baseline; no provider calls or latency/token claims. Independent evaluation and source context retained.', concurrency: 2, results }, null, 2));
