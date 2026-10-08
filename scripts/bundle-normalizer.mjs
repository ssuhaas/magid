import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'bid normalizer');
const checking = process.argv.includes('--check');
const expected = new Map();

// Generate the portable runtime from the app's maintained source, not a second fork.
function collect(path) {
  const target = resolve(destination, 'src', relative(resolve(root, 'lib'), path));
  if (expected.has(target)) return;
  const bytes = readFileSync(path);
  expected.set(target, bytes);
  if (path.endsWith('.json')) return;
  for (const match of bytes.toString().matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
    collect(resolve(dirname(path), match[1]));
}
for (const entry of ['normalize.mjs', 'projection.mjs', 'item-coverage.mjs']) {
  const text = readFileSync(resolve(destination, entry), 'utf8');
  for (const match of text.matchAll(/['"]\.\/src\/([^'"]+)['"]/g))
    collect(resolve(root, 'lib', match[1]));
}
for (const path of ['review-types.ts', 'ai/types.ts']) {
  expected.set(resolve(destination, 'src', path), readFileSync(resolve(root, 'lib', path)));
}
expected.set(resolve(destination, 'template.xlsx'), readFileSync(resolve(root, 'public/template.xlsx')));

function files(path) {
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(resolve(path, entry.name)) : [resolve(path, entry.name)]);
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const obsolete = files(resolve(destination, 'src')).filter(path => !expected.has(path));
const changed = [...expected].filter(([path, bytes]) => {
  try { return !readFileSync(path).equals(bytes); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
});
if (checking && (changed.length || obsolete.length))
  throw Error('Portable runtime is stale. Run npm run bundle:normalizer and commit the generated files.');
if (!checking) {
  for (const path of obsolete) rmSync(path);
  for (const [path, bytes] of changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}
console.log(`Portable runtime ${checking ? 'verified' : 'generated'} (${expected.size} files).`);
