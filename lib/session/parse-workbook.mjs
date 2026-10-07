// @ts-check
/**
 * Browser parser transport. The coordinator owns cleanup and stale-worker isolation.
 * @param {{session: ReturnType<typeof import('./coordinator.mjs').createSessionCoordinator>, generation: number,
 * bytes: Uint8Array, filename: string, debug: boolean, createWorker: () => Worker,
 * progress: (event: import('./types').ParserProgress) => void, timeoutMs?: number}} options
 * @returns {Promise<import('./types').ParsedWorkbook>}
 */
export function parseWorkbookInWorker({ session, generation, bytes, filename, debug, createWorker, progress, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    /** @param {Error | null} error @param {import('./types').ParsedWorkbook} [result] */
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      session.releaseParser(resource);
      if (error) reject(error);
      else resolve(/** @type {import('./types').ParsedWorkbook} */ (result));
    };
    const resource = {
      worker,
      timer: setTimeout(() => finish(Error('Workbook processing timed out after 60 seconds. Try a smaller workbook or manual handling.')), timeoutMs),
      cancel: (/** @type {Error} */ error) => finish(error),
    };
    if (!session.trackParser(generation, resource)) return;
    worker.onmessage = event => {
      if (settled) return;
      if (event.data.progress) {
        if (session.isCurrent(generation)) progress(event.data.progress);
        return;
      }
      if (event.data.error) finish(Error(event.data.error));
      else finish(null, event.data);
    };
    worker.onerror = () => finish(Error('Workbook worker failed. Please retry.'));
    try {
      worker.postMessage({ bytes, filename, debug });
    } catch (error) {
      finish(/** @type {Error} */ (error));
    }
  });
}
