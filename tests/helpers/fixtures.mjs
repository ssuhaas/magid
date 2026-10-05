import { readFileSync as read } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const manifest = JSON.parse(read(new URL('../fixture-manifest.json', import.meta.url), 'utf8'));
export const fixtureRoot = resolve(projectRoot, process.env.MAGID_FIXTURE_ROOT || 'tests/fixtures');

// Preserve existing test paths while making their external data location explicit.
export function readFileSync(path, options) {
  if (typeof path === 'string' && /^\.\.\/(attachments|expected-records)\//.test(path)) {
    return read(resolve(fixtureRoot, path.slice(3)), options);
  }
  return read(path, options);
}

export function checkFixtures(root = fixtureRoot) {
  const problems = [];
  for (const file of manifest.files) {
    try {
      const bytes = read(resolve(root, file.path));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== file.sha256) problems.push(`Changed fixture: ${file.path}`);
    } catch (error) {
      problems.push(`${error.code === 'ENOENT' ? 'Missing fixture' : 'Unreadable fixture'}: ${file.path}`);
    }
  }
  if (problems.length) {
    throw Error(`${problems.join('\n')}\nRun npm run fixtures:setup -- --from /path/to/source-folder, or set MAGID_FIXTURE_ROOT to that folder. The folder must contain attachments/ and expected-records/.`);
  }
  return manifest.files;
}
