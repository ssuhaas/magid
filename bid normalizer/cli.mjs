#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { createBidNormalizer, createBidNormalizerWithSource } from './index.mjs';

const args = process.argv.slice(2);
const withSource = args[0] === '--with-source';
const [input, output, ...extra] = withSource ? args.slice(1) : args;
try {
  if (!input || !output || extra.length) throw Error('Usage: bid-normalizer [--with-source] proposal.xlsx output.xlsx-or-zip');
  if (resolve(input) === resolve(output)) throw Error('Input and output paths must differ.');
  const provider = process.env.AI_PROVIDER || 'openai';
  if (withSource && !/\.zip$/i.test(output)) throw Error('Use a .zip output path with --with-source.');
  const normalize = (withSource ? createBidNormalizerWithSource : createBidNormalizer)({ provider,
    key: provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
    model: provider === 'gemini' ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL });
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  const result = await normalize(await readFile(input), { filename: basename(input), signal: abort.signal });
  const bytes = withSource ? zipSync({
    [result.original.filename]: result.original.bytes,
    [result.normalized.filename]: result.normalized.bytes,
  }) : result;
  await writeFile(output, bytes, { flag: 'wx' });
  console.log(withSource ? 'Original proposal and normalized workbook written to ZIP.' : 'Normalized workbook written.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Output already exists. Choose a new output path.' : error.message);
  process.exitCode = 1;
}
