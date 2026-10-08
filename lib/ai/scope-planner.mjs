// @ts-check
import { buildScope } from './client.mjs';

export const DEFAULT_SCOPE_MAX_ITEMS = 3;
const MAX_SCOPE_ITEMS = 6;
const FIELD_BUDGET = 36;
const PAYLOAD_BUDGET = 60000;

/** Invalid/unrecognized configuration retains the established three-item plan.
 * @param {unknown} value
 */
export function scopeMaxItems(value) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= DEFAULT_SCOPE_MAX_ITEMS &&
    value <= MAX_SCOPE_ITEMS
    ? value
    : DEFAULT_SCOPE_MAX_ITEMS;
}

/**
 * Preserve source order and all requested fields/evidence. Larger groups are opt-in;
 * keep their generation workload within the old three fully unresolved items.
 * Never remove context to satisfy a budget. A single large item retains hard limits.
 * @param {import('../review-types').Book} book
 * @param {import('../review-types').Item[]} records
 * @param {{digest: string, maxItems?: number, createScopeId?: () => string}} options
 * @returns {import('./types').SourceScope[]}
 */
export function planEnrichmentScopes(
  book,
  records,
  { digest, maxItems = DEFAULT_SCOPE_MAX_ITEMS, createScopeId = () => crypto.randomUUID() },
) {
  const limit = scopeMaxItems(maxItems);
  const build = (
    /** @type {import('../review-types').Item[]} */ group,
    /** @type {string} */ scopeId,
  ) => buildScope(book, group, { digest, scopeId, targeted: true });
  // Default plans retain the exact prior grouping and context, including sheet transitions.
  if (limit === DEFAULT_SCOPE_MAX_ITEMS)
    return Array.from({ length: Math.ceil(records.length / limit) }, (_, i) =>
      build(records.slice(i * limit, (i + 1) * limit), createScopeId()),
    );

  const scopes = [];
  for (let start = 0; start < records.length; ) {
    const scopeId = createScopeId();
    let scope = build(records.slice(start, start + 1), scopeId);
    let size = 1;
    for (let count = 2; count <= limit && start + count <= records.length; count++) {
      const next = records[start + count - 1];
      if (next.sheet !== records[start].sheet || next.section !== records[start].section) break;
      let candidate;
      try {
        candidate = build(records.slice(start, start + count), scopeId);
      } catch (error) {
        if (error instanceof Error && error.message.includes('source scope is too large')) break;
        throw error;
      }
      const fields = candidate.records.reduce((n, r) => n + (r.requestedColumns?.length ?? 12), 0);
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).length;
      if (fields > FIELD_BUDGET || bytes > PAYLOAD_BUDGET) break;
      scope = candidate;
      size = count;
    }
    scopes.push(scope);
    start += size;
  }
  return scopes;
}

/** Counts/payload sizes only, never source values or estimated token usage.
 * @param {import('./types').SourceScope[]} scopes
 */
export function scopeWork(scopes) {
  const sizes = scopes.map((s) => new TextEncoder().encode(JSON.stringify(s)).length);
  return {
    groups: scopes.length,
    providerCallsBeforeRetry: scopes.length * 2,
    requestedFields: scopes
      .flatMap((s) => s.records)
      .reduce((n, r) => n + (r.requestedColumns?.length ?? 12), 0),
    sourceCellsWithRepeatedContext: scopes.reduce((n, s) => n + s.cells.length, 0),
    sourcePayloadBytes: sizes.reduce((a, b) => a + b, 0),
    largestSourcePayloadBytes: Math.max(0, ...sizes),
  };
}
