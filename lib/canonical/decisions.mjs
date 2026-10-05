/** Tokens stay inside this browser session; API/model output cannot supply them. */
export function captureDecision(state) {
  return Object.freeze({ ...state });
}
export function assertCurrentDecision(token, current) {
  for (const key of ['generation', 'reviewRevision', 'sourceDigest', 'controllerRevision'])
    if (token[key] !== current[key])
      throw Error(
        'The source or review decisions changed after this operation started. Reopen the preview or retry with the current proposal.',
      );
}

/** AI owns its proof bookkeeping; source and genuine reviewer changes still invalidate it. */
export function capturePipeline(state) {
  return Object.freeze(
    Object.fromEntries(
      ['generation', 'reviewRevision', 'sourceDigest', 'runId'].map((k) => [k, state[k]]),
    ),
  );
}
export function assertCurrentPipeline(token, current) {
  for (const key of ['generation', 'reviewRevision', 'sourceDigest', 'runId'])
    if (token[key] !== current[key])
      throw Error(
        'The proposal or reviewer decisions changed. Retry AI processing with the current proposal.',
      );
}
