import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkFixtures, projectRoot, manifest } from '../tests/helpers/fixtures.mjs';

process.chdir(projectRoot);
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--core')) {
  console.error('Usage: npm run verify [-- --core]');
  process.exit(1);
}
const profile = args[0] === '--core' ? 'core' : 'full';
const python = process.env.PYTHON || 'python3';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() || 'unavailable';
const report = {
  profile,
  startedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain') !== '',
  node: process.version,
  python,
  fixtures: profile === 'full' ? manifest.files : [],
  stages: [],
  status: 'failed',
  limitations: 'Controlled AI responses only. Live provider accuracy, browser acceptance and downloaded-output inspection require separate checks.',
};
const output = resolve(projectRoot, '.verification', `${profile}-${Date.now()}`);
mkdirSync(output, { recursive: true });

function run(name, command, args, timeout = 300000) {
  console.log(`\n[${profile}] ${name}`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, PYTHON: python },
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024,
  });
  const log = (result.stdout || '') + (result.stderr || '') + (result.error ? `\n${result.error.message}` : '');
  writeFileSync(resolve(output, `${name}.log`), log);
  process.stdout.write(log);
  const passed = !result.error && result.status === 0;
  report.stages.push({ name, status: passed ? 'passed' : 'failed', exitCode: result.status, signal: result.signal, milliseconds: Date.now() - started });
  if (!passed) throw Error(`${name} failed. See ${output}/${name}.log`);
  return result;
}

try {
  if (profile === 'full') {
    checkFixtures();
    report.stages.push({ name: 'fixtures', status: 'passed', count: manifest.files.length });
  } else {
    console.log('CORE ONLY: real-workbook regression checks are not included. This is not full acceptance.');
  }
  const pythonVersion = run('python-version', python, ['--version']);
  report.pythonVersion = (pythonVersion.stdout || pythonVersion.stderr).trim();
  const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort();
  // This profile excludes entire files that need private fixtures; no tests are silently skipped.
  const selected = profile === 'full' ? tests : tests.filter(name => !readFileSync(`tests/${name}`, 'utf8').includes('./helpers/fixtures.mjs'));
  if (!selected.length) throw Error('No test files selected.');
  report.testFiles = selected;
  report.excludedTestFiles = tests.filter(name => !selected.includes(name));
  run('javascript-tests', process.execPath, ['--test', ...selected.map(name => `tests/${name}`)]);
  run('types', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
  run('python-validator-tests', python, ['-m', 'unittest', 'discover', '-s', 'lib/canonical/reference', '-p', 'test_*.py']);
  run('production-build', process.execPath, ['scripts/run-framework.mjs', 'build']);
  report.status = 'passed';
} catch (error) {
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${profile.toUpperCase()} verification ${report.status}. Report: ${output}/report.json`);
}
