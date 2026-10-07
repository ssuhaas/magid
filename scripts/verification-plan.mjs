import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every test must have an explicit suite; unknown or stale entries fail closed. */
export function selectTests(profile, discovered, suites) {
  if (!['core', 'full'].includes(profile)) throw Error(`Unknown verification profile: ${profile}`);
  if (!suites || Object.keys(suites).sort().join(',') !== 'core,workbook' ||
      !Array.isArray(suites.core) || !Array.isArray(suites.workbook)) {
    throw Error('Verification suites must define core and workbook arrays.');
  }
  const registered = [...suites.core, ...suites.workbook];
  if (registered.some(name => typeof name !== 'string' || !/^[\w-]+\.test\.mjs$/.test(name))) {
    throw Error('Invalid test filename in verification suites.');
  }
  if (new Set(registered).size !== registered.length) throw Error('Duplicate test in verification suites.');
  const unclassified = discovered.filter(name => !registered.includes(name));
  const missing = registered.filter(name => !discovered.includes(name));
  if (unclassified.length || missing.length) {
    throw Error(`Update tests/verification-suites.json. Unclassified: ${unclassified.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`);
  }
  const selected = [...(profile === 'full' ? registered : suites.core)].sort();
  if (!selected.length) throw Error('No test files selected.');
  return { selected, excluded: discovered.filter(name => !selected.includes(name)).sort() };
}

export function loadTestPlan(profile, root) {
  const discovered = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs'));
  const suites = JSON.parse(readFileSync(resolve(root, 'tests/verification-suites.json'), 'utf8'));
  return selectTests(profile, discovered, suites);
}
