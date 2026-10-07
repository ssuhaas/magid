// @ts-check
import { createNormalizationCache } from '../ai/normalize-proposal.mjs';
import { assertCurrentDecision } from '../canonical/decisions.mjs';

const IDLE_LIMIT = 3600000;
const ABSOLUTE_LIMIT = 28800000;
const DOWNLOAD_GRACE = 900000;

/**
 * Own temporary resources and operation identity, not React state or approvals.
 * @param {{now?: () => number, revokeURL?: (url: string) => void}} options
 */
export function createSessionCoordinator({ now = Date.now, revokeURL = url => URL.revokeObjectURL(url) } = {}) {
  let generation = 0, reviewRevision = 0, sourceDigest = '';
  /** @type {Uint8Array | null} */
  let sourceBytes = null;
  let born = 0, active = 0, grace = 0, downloadURL = '';
  /** @type {string | null} */
  let operation = null;
  /** @type {AbortController | null} */
  let aiAbort = null;
  /** @type {import('./types').ParserResource | null} */
  let parser = null;
  const releasedParsers = new WeakSet();
  const cache = createNormalizationCache();

  function invalidateDownload() {
    if (downloadURL) revokeURL(downloadURL);
    downloadURL = '';
  }
  /** @param {import('./types').ParserResource} resource */
  function releaseParser(resource) {
    if (releasedParsers.has(resource)) return;
    releasedParsers.add(resource);
    clearTimeout(resource.timer);
    resource.worker.terminate();
    // A late callback from an old worker must not release its replacement.
    if (parser === resource) parser = null;
  }
  /** @param {string} message */
  function stopResources(message) {
    aiAbort?.abort();
    aiAbort = null;
    const pending = parser;
    if (pending) {
      releaseParser(pending);
      pending.cancel(Error(message));
    }
  }
  return {
    cache,
    get generation() { return generation; },
    get reviewRevision() { return reviewRevision; },
    get sourceDigest() { return sourceDigest; },
    get sourceBytes() { return sourceBytes; },
    get operation() { return operation; },
    /** @param {number} current */
    isCurrent(current) { return current === generation; },
    /** @param {number} controllerRevision @returns {import('./types').DecisionState} */
    decisionState(controllerRevision) {
      return { generation, reviewRevision, sourceDigest, controllerRevision };
    },
    reviewChanged() {
      reviewRevision++;
      invalidateDownload();
    },
    reset() {
      operation = null;
      cache.stages.clear();
      cache.plan = null;
      invalidateDownload();
      generation++;
      reviewRevision++;
      stopResources('Processing canceled.');
      sourceDigest = '';
      sourceBytes = null;
      grace = 0;
    },
    dispose() {
      // Invalidate owners before rejecting pending work on page close.
      generation++;
      reviewRevision++;
      operation = null;
      stopResources('Page closed.');
      sourceBytes = null;
      sourceDigest = '';
      cache.stages.clear();
      cache.plan = null;
      invalidateDownload();
    },
    /** @param {number} owner @param {Uint8Array} bytes @param {string} digest */
    acceptSource(owner, bytes, digest) {
      if (owner !== generation) return false;
      sourceDigest = digest;
      sourceBytes = bytes;
      born = active = now();
      return true;
    },
    /** @param {string} runId */
    beginAI(runId) {
      if (operation) return null;
      operation = runId;
      aiAbort = new AbortController();
      return aiAbort;
    },
    cancelAI() { aiAbort?.abort(); },
    /** @param {string} runId */
    finishAI(runId) {
      if (operation !== runId) return false;
      operation = null;
      aiAbort = null;
      return true;
    },
    beginExport() {
      if (operation) return false;
      operation = 'export';
      return true;
    },
    /** @param {number} owner */
    finishExport(owner) {
      if (owner !== generation || operation !== 'export') return false;
      operation = null;
      return true;
    },
    /** @param {number} owner @param {import('./types').ParserResource} resource */
    trackParser(owner, resource) {
      if (owner !== generation) {
        releaseParser(resource);
        resource.cancel(Error('Processing canceled.'));
        return false;
      }
      parser = resource;
      return true;
    },
    releaseParser,
    invalidateDownload,
    /** @param {object} token @param {number} controllerRevision @param {() => string} createURL */
    publishDownload(token, controllerRevision, createURL) {
      assertCurrentDecision(token, { generation, reviewRevision, sourceDigest, controllerRevision });
      // Keep the previous URL if URL creation fails, matching the existing behavior.
      const url = createURL();
      invalidateDownload();
      downloadURL = url;
      return url;
    },
    touch() { active = now(); },
    downloadRequested() { grace = now() + DOWNLOAD_GRACE; },
    continueReview() { grace = 0; active = now(); },
    lifetime() {
      if (!sourceBytes) return null;
      const time = now();
      return {
        remaining: Math.min(IDLE_LIMIT - (time - active), ABSOLUTE_LIMIT - (time - born), grace ? grace - time : Infinity),
        absoluteWarning: time - born >= ABSOLUTE_LIMIT - 300000,
        expired: time - active > IDLE_LIMIT || time - born > ABSOLUTE_LIMIT || !!(grace && time > grace),
      };
    },
  };
}
