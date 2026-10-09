import { z } from 'zod';
import { responseSchema, outputJSONSchema, partitionProposal, TASK } from './contracts.mjs';

const nonItem = z.object({
  sheet: z.string().min(1).max(100),
  cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
  disposition: z.enum(['header', 'context']),
  quote: z.string().min(1).max(32767),
  reason: z.string().min(1).max(700),
}).strict();
export const discoveryResponseSchema = responseSchema.extend({ nonItems: z.array(nonItem).max(900) });
export const discoveryJSONSchema = {
  ...outputJSONSchema,
  required: [...outputJSONSchema.required, 'nonItems'],
  properties: { ...outputJSONSchema.properties, nonItems: {
    type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['sheet', 'cell', 'disposition', 'quote', 'reason'],
      properties: { sheet: { type: 'string' }, cell: { type: 'string' },
        disposition: { type: 'string', enum: ['header', 'context'] },
        quote: { type: 'string' }, reason: { type: 'string' } },
    },
  } },
};
export const DISCOVERY_TASK = TASK + `
This is a completeness recovery pass. Cells with eligibleAnchor=true are UNACCOUNTED source cells, even on a recognized sheet or beside an existing item. Inspect every one. Recover ALL product occurrences, including parallel lists, repeated products, later tables and wrapped descriptions. Cells with eligibleAnchor=false are context only: never create another item from them. Keep all cells of a wrapped product in its anchors. Every eligible cell must appear in exactly one item's anchors or in nonItems. nonItems must give the exact full source quote and a short reason for an actual heading or non-product context. Never label a product, product identifier or unresolved product relationship as context to complete coverage. Return ambiguous=true or a warning if coverage cannot be resolved. Each recovered product needs a source-backed description in E/F or a Source Product ID extra. Do not omit empty-field items or truncate a group to fit the response.`;

/** Coverage is checked BEFORE rejected individual fields are quarantined. */
export function validateDiscovery(scope, output) {
  const result = discoveryResponseSchema.parse(output);
  const { nonItems, ...proposal } = result;
  const accounted = new Set();
  const candidates = new Map(scope.cells.filter(c => c.eligibleAnchor)
    .map(c => [JSON.stringify([c.sheet, c.cell]), c]));
  const claim = (sheet, cell) => {
    const key = JSON.stringify([sheet, cell]);
    if (!candidates.has(key) || accounted.has(key))
      throw Error('Discovery coverage contains a duplicate or out-of-scope source cell.');
    accounted.add(key);
  };
  for (const item of proposal.items) {
    for (const cell of item.anchors) claim(item.sheet, cell);
  }
  for (const entry of nonItems) {
    claim(entry.sheet, entry.cell);
    const original = candidates.get(JSON.stringify([entry.sheet, entry.cell]));
    if (entry.quote !== original.raw) throw Error('Non-item source quote was altered.');
    if (/Item\s*#|^\s*Product:/i.test(original.raw)) accounted.delete(JSON.stringify([entry.sheet, entry.cell]));
  }
  const partitioned = partitionProposal(scope, proposal);
  const missing = [...candidates].filter(([key]) => !accounted.has(key)).map(([, c]) => c);
  partitioned.proposal.items.push(...rawItems(missing));
  // Uncertainty is preserved for the later evaluator; it never becomes an approval gate.
  return { ...partitioned, nonItems };
}

/** Preserve original unclassified source by row; never invent product facts. */
export function rawItems(cells) {
  const groups = new Map();
  for (const cell of cells) {
    const key = JSON.stringify([cell.sheet, cell.cell.replace(/\D/g, '')]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cell);
  }
  return [...groups.values()].map(group => ({ recordId: '', sheet: group[0].sheet,
    anchors: group.map(c => c.cell), section: '', ambiguous: true,
    boundaryReason: 'Original source retained because product relationships are unresolved.',
    fields: [], extras: [] }));
}
