import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTests } from '../scripts/verification-plan.mjs';

const discovered = ['portable.test.mjs', 'tesla.test.mjs'];
const suites = { core: ['portable.test.mjs'], workbook: ['tesla.test.mjs'] };

test('core excludes private workbooks and full includes every registered test', () => {
  assert.deepEqual(selectTests('core', discovered, suites), {
    selected: ['portable.test.mjs'], excluded: ['tesla.test.mjs'],
  });
  assert.deepEqual(selectTests('full', discovered, suites), { selected: discovered, excluded: [] });
});

test('new, deleted or duplicate tests cannot silently change verification coverage', () => {
  assert.throws(() => selectTests('core', [...discovered, 'new.test.mjs'], suites), /Unclassified: new/);
  assert.throws(() => selectTests('full', ['portable.test.mjs'], suites), /missing: tesla/);
  assert.throws(() => selectTests('core', discovered, { ...suites, workbook: discovered }), /Duplicate/);
});

test('invalid profiles, malformed configuration and empty core suites fail clearly', () => {
  assert.throws(() => selectTests('fast', discovered, suites), /Unknown/);
  assert.throws(() => selectTests('core', discovered, { core: [], typo: discovered }), /arrays/);
  assert.throws(() => selectTests('core', discovered, { core: [], workbook: discovered }), /No test/);
  assert.throws(() => selectTests('core', [], { core: ['../escape.test.mjs'], workbook: [] }), /Invalid/);
});
