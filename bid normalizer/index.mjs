import { readFile } from 'node:fs/promises';
import { normalize } from './normalize.mjs';

/** Server-side factory. Configuration and the template are reusable; bid state is not. */
export function createBidNormalizer(config = {}) {
  const options = { ...config };
  const template = options.templateBytes
    ? Promise.resolve(new Uint8Array(options.templateBytes))
    : readFile(new URL('./template.xlsx', import.meta.url));
  return async (proposalBytes, request = {}) => normalize(
    new Uint8Array(proposalBytes),
    new Uint8Array(await template),
    options,
    request,
  );
}
