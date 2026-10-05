/** Cache is supplied by the temporary browser session, never persisted. */
export async function requestStage(
  stage,
  input,
  { signal, observer = () => {}, fetchImpl = fetch } = {},
) {
  const abort = new AbortController(),
    cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 28000);
  try {
    let response;
    try {
      response = await fetchImpl('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Stage': stage,
          'X-Pipeline-Debug': '1',
        },
        body: JSON.stringify(input),
        signal: abort.signal,
      });
    } catch {
      const e = new Error(
        signal?.aborted
          ? 'AI processing canceled.'
          : 'AI processing timed out. Retry will resume completed stages.',
      );
      e.status = 504;
      throw e;
    }
    let result;
    try {
      result = await response.json();
    } catch {
      const e = new Error(
        'The processing service did not return a complete result. Retry will resume completed stages.',
      );
      e.status = response.status >= 400 ? response.status : 502;
      throw e;
    }
    for (const event of result.debug || []) observer(event);
    if (!response.ok) {
      const e = new Error(result.error || 'AI processing failed. Retry to resume.');
      e.status = response.status;
      e.code = result.code;
      e.retryAfter = Number(response.headers?.get('Retry-After')) || 3;
      throw e;
    }
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export async function processStages(
  scope,
  { cache, check, send = requestStage, signal, observer, progress = (stage) => {} },
) {
  check();
  let state = cache.get(scope.scopeId);
  if (!state) {
    state = { scope };
    cache.set(scope.scopeId, state);
  }
  if (JSON.stringify(state.scope) !== JSON.stringify(scope))
    throw Error('Cached AI scope does not match the current source.');
  for (const stage of ['extract', 'evaluate']) {
    check();
    if (state[stage]) continue;
    progress(stage);
    const input = stage === 'extract' ? scope : { source: scope, proposal: state.extract.proposal };
    let result;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await send(stage, input, { signal, observer });
        break;
      } catch (e) {
        if (
          attempt >= 9 ||
          !['SESSION_BUSY', 'SERVICE_BUSY', 'REQUEST_RATE_LIMIT'].includes(e.code)
        )
          throw e;
        check();
        const seconds = Math.min(60, Math.max(1, e.retryAfter || 3));
        progress(
          'waiting',
          `${e.message} Next attempt in ${seconds} seconds. You can cancel while waiting.`,
        );
        observer?.({
          stage: 'ai',
          status: 'waiting',
          message: e.message,
          detail: { retryAfter: seconds },
        });
        await waitForSlot(seconds * 1000, signal);
        check();
        progress(stage);
      }
    }
    check();
    if (result.digest !== scope.digest || result.scopeId !== scope.scopeId)
      throw Error('AI response belongs to a different source or scope.');
    state[stage] = result;
  }
  return { ...state.extract, evaluation: state.evaluate.evaluation };
}

export function waitForSlot(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(Error('AI processing canceled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
