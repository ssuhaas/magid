import { coverageIndex, prepareCoverage, applyCoverage } from './coverage.mjs';

/** Cells supplying item identities or output fields cannot be dismissed as optional context. */
function protectedCells(records, columns) {
  const cells = new Set();
  for (const record of records) {
    if (record.boundary === 'exclude') continue;
    const fields = [
      ...Object.values(record.values),
      ...Object.entries(record.extras)
        .filter(([name]) => columns[name] === 'approved')
        .map(([, field]) => field),
    ];
    for (const address of [
      ...record.anchors,
      ...fields
        .filter((field) => field.value || field.status === 'pending')
        .flatMap((field) => field.evidence),
    ])
      cells.add(JSON.stringify([record.sheet, address]));
  }
  return cells;
}

function omissionPlans(index, groups, reason) {
  return groups.flatMap(({ sheet, addresses }) => {
    const plans = [];
    for (let i = 0; i < addresses.length; i += 100) {
      plans.push(
        prepareCoverage(index, {
          sheet,
          addresses: addresses.slice(i, i + 100),
          disposition: 'excluded',
          role: 'context',
          reason,
        }),
      );
    }
    return plans;
  });
}

/** A declined column resolves optional source coverage without approving its values. */
export function declineExtraInformation({
  book,
  records,
  columns,
  controller,
  name,
  definition = {},
}) {
  const nextColumns = { ...columns, [name]: 'declined' };
  const protectedSource = protectedCells(records, nextColumns);
  const bySheet = new Map();
  for (const record of records) {
    if (record.boundary === 'exclude') continue;
    for (const address of record.extras[name]?.evidence || []) {
      if (protectedSource.has(JSON.stringify([record.sheet, address]))) continue;
      if (!bySheet.has(record.sheet)) bySheet.set(record.sheet, new Set());
      bySheet.get(record.sheet).add(address);
    }
  }
  const index = coverageIndex(book, records, controller);
  const plans = omissionPlans(
    index,
    [...bySheet].map(([sheet, addresses]) => ({ sheet, addresses: [...addresses] })),
    `Reviewer chose not to add "${name}". Its optional source information is intentionally omitted.`,
  );
  // Prepare every scope before changing the column or coverage registry.
  controller.column(name, 'declined', definition);
  for (const plan of plans) {
    applyCoverage(controller, index, plan);
    for (const cell of plan.cells) {
      controller.coverage.get(JSON.stringify([plan.sheet, cell.address])).omittedColumn = name;
    }
  }
  return nextColumns;
}

/** Re-adding a column reopens source decisions made specifically to omit it.
 * @param {{columns: Record<string, string>, records?: any[], controller: any, name: string, definition?: object}} options
 */
export function approveExtraInformation({
  columns,
  records = [],
  controller,
  name,
  definition = {},
}) {
  const sources = new Set(
    records.flatMap((record) =>
      (record.extras[name]?.evidence || []).map((address) =>
        JSON.stringify([record.sheet, address]),
      ),
    ),
  );
  controller.column(name, 'approved', definition);
  for (const [key, decision] of controller.coverage) {
    if (decision.omittedColumn && (decision.omittedColumn === name || sources.has(key))) {
      controller.coverage.delete(key);
    }
  }
  return { ...columns, [name]: 'approved' };
}

/** Explicitly omit a reviewed source group; never silently remove item evidence. */
export function omitProposalInformation({ book, records, columns, controller, sheet, addresses }) {
  const protectedSource = protectedCells(records, columns);
  if (addresses.some((address) => protectedSource.has(JSON.stringify([sheet, address])))) {
    throw Error(
      'This group supplies item information. Review its items or fields before omitting it.',
    );
  }
  const index = coverageIndex(book, records, controller);
  const plans = omissionPlans(
    index,
    [{ sheet, addresses }],
    'Reviewer checked this proposal information and chose to leave it out of the normalized sheet.',
  );
  for (const plan of plans) applyCoverage(controller, index, plan);
}
