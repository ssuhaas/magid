import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { checkFixtures, fixtureRoot } from '../tests/helpers/fixtures.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--from') {
  console.error('Usage: npm run fixtures:setup -- --from /path/to/source-folder');
  process.exit(1);
}
try {
  const source = resolve(args[1]);
  // Validate the entire set before copying anything; never replace expected truth silently.
  const files = checkFixtures(source);
  for (const file of files) {
    const target = resolve(fixtureRoot, file.path);
    mkdirSync(dirname(target), { recursive: true });
    if (target !== resolve(source, file.path)) copyFileSync(resolve(source, file.path), target);
  }
  checkFixtures();
  console.log(`Ready: ${files.length} fixtures match the pinned SHA-256 hashes.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
