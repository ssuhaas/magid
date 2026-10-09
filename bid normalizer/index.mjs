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

/** Return both Excel files without retaining either proposal after the call. */
export function createBidNormalizerWithSource(config = {}) {
  const normalizeBid = createBidNormalizer(config);
  return async (proposalBytes, request = {}) => {
    // Snapshot before awaiting: later mutations by the caller cannot change the source.
    const bytes = new Uint8Array(proposalBytes);
    const filename = (request.filename || 'proposal.xlsx').replaceAll('\\', '/').split('/').at(-1);
    const normalizedBytes = await normalizeBid(bytes, { ...request, filename });
    return {
      original: { filename, bytes },
      normalized: { filename: filename.replace(/\.(xlsx|xlsm)$/i, '') + '-normalized.xlsx', bytes: normalizedBytes },
    };
  };
}
