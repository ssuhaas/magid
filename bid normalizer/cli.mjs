#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createBidNormalizer } from './index.mjs';

const [input, output, ...extra] = process.argv.slice(2);
try {
  if (!input || !output || extra.length) throw Error('Usage: bid-normalizer proposal.xlsx normalized.xlsx');
  if (resolve(input) === resolve(output)) throw Error('Input and output paths must differ.');
  const provider = process.env.AI_PROVIDER || 'openai';
  const normalize = createBidNormalizer({ provider,
    key: provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
    model: provider === 'gemini' ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL });
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  const bytes = await normalize(await readFile(input), { filename: basename(input), signal: abort.signal });
  await writeFile(output, bytes, { flag: 'wx' });
  console.log('Normalized workbook written.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Output already exists. Choose a new output path.' : error.message);
  process.exitCode = 1;
}
