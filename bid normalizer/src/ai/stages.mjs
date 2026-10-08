// @ts-check
/** @typedef {import('./types').ProcessingError} ProcessingError */
/** @typedef {import('./types').ExtractionResult} ExtractionResult */
/** @typedef {import('./types').EvaluationResult} EvaluationResult */
/** @typedef {import('./types').StageResult} StageResult */
/** @typedef {import('./types').AIStage} AIStage */
/**
 * Cache is supplied by the temporary browser session, never persisted.
 * @param {AIStage} stage
 * @param {import('./types').StageInput} input
 * @param {import('./types').RequestControls & {fetchImpl?: typeof fetch}} options
 * @returns {Promise<StageResult>}
 */
export async function requestStage(
  stage,
  input,
  { signal, observer = () => {}, fetchImpl = fetch } = {},
) {
  const abort = new AbortController(),
    cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const started = performance.now();
  let outcome = 'failed';
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
      const e = /** @type {ProcessingError} */ (
        new Error(
          signal?.aborted
            ? 'AI processing canceled.'
            : 'AI processing timed out. Retry will resume completed stages.',
        )
      );
      e.status = 504;
      throw e;
    }
    let result;
    try {
      result = await response.json();
    } catch {
      const e = /** @type {ProcessingError} */ (
        new Error(
          'The processing service did not return a complete result. Retry will resume completed stages.',
        )
      );
      e.status = response.status >= 400 ? response.status : 502;
      throw e;
    }
    for (const event of result.debug || []) observer(event);
    if (!response.ok) {
      const e = /** @type {ProcessingError} */ (
        new Error(result.error || 'AI processing failed. Retry to resume.')
      );
      e.status = response.status;
      e.code = result.code;
      e.retryAfter = Number(response.headers?.get('Retry-After')) || 3;
      throw e;
    }
    outcome = 'completed';
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    // Diagnostics are optional and never change the outcome of a request.
    try {
      observer({
        stage: stage === 'extract' ? 'ai' : 'evaluate',
        status: 'timed',
        message: 'AI stage request timing.',
        detail: {
          scopeId: 'source' in input ? input.source.scopeId : input.scopeId,
          stage,
          outcome: signal?.aborted ? 'canceled' : outcome,
          milliseconds: Math.max(0, Math.round(performance.now() - started)),
        },
      });
    } catch {
      /* Observer failures do not alter request results. */
    }
  }
}
/**
 * @param {import('./types').SourceScope} scope
 * @param {import('./types').StageOptions} options
 * @returns {Promise<import('./types').EvaluatedProposal>}
 */
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
  for (const stage of /** @type {AIStage[]} */ (['extract', 'evaluate'])) {
    check();
    if (state[stage]) continue;
    progress(stage);
    const input =
      stage === 'extract'
        ? scope
        : { source: scope, proposal: /** @type {ExtractionResult} */ (state.extract).proposal };
    let result;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await send(stage, input, { signal, observer });
        break;
      } catch (e) {
        const error = /** @type {ProcessingError} */ (e);
        if (
          attempt >= 9 ||
          !(
            /** @type {unknown[]} */ ([
              'SESSION_BUSY',
              'SERVICE_BUSY',
              'REQUEST_RATE_LIMIT',
            ]).includes(error.code)
          )
        )
          throw e;
        check();
        const seconds = Math.min(60, Math.max(1, error.retryAfter || 3));
        progress(
          'waiting',
          `${error.message} Next attempt in ${seconds} seconds. You can cancel while waiting.`,
        );
        observer?.({
          stage: 'ai',
          status: 'waiting',
          message: error.message,
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
    // The stage selects the service response; digest/scope checks above are unchanged.
    /** @type {{extract?: StageResult, evaluate?: StageResult}} */ (state)[stage] = result;
  }
  return {
    .../** @type {ExtractionResult} */ (state.extract),
    evaluation: /** @type {EvaluationResult} */ (state.evaluate).evaluation,
  };
}

/** @param {number} ms @param {AbortSignal} [signal] @returns {Promise<void>} */
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
