export const cellKey = (sheet, address) => JSON.stringify([sheet, address]);
export const coverageRoles = [
  'customer_specification',
  'context',
  'quoted_exact',
  'quoted_alternate',
  'historical',
  'catalog',
];
export const dispositions = ['item', 'header', 'context', 'excluded'];
const serialize = (v) => JSON.stringify(v);
/** Index source associations once per item revision. No classification or approval is inferred. */
export function coverageIndex(book, records, controller) {
  const links = new Map(),
    sheets = new Map(book.sheets.map((s) => [s.name, s]));
  for (const r of records) {
    const addresses = new Set([
        ...r.anchors,
        ...Object.values(r.values).flatMap((f) => f.evidence),
        ...Object.values(r.extras).flatMap((f) => f.evidence),
      ]),
      signature = serialize([
        r.id,
        controller?.itemRevisions.get(r.id) || 0,
        r.sheet,
        r.anchors,
        r.section,
        r.boundary,
        Object.entries(r.values).map(([k, f]) => [k, f.value, f.evidence, f.status]),
        Object.entries(r.extras).map(([k, f]) => [k, f.value, f.evidence, f.status]),
      ]);
    for (const a of addresses) {
      const k = cellKey(r.sheet, a);
      if (!links.has(k)) links.set(k, []);
      links.get(k).push({ id: r.id, boundary: r.boundary, signature });
    }
  }
  return { book, records, links, sheets };
}
export function cellSignature(index, sheet, address) {
  const s = index.sheets.get(sheet),
    c = s?.cells[address];
  if (!c) throw Error('Selected source cell is missing.');
  return serialize([
    sheet,
    address,
    c.raw,
    c.type,
    c.formula,
    s.hidden,
    (s.hiddenRows || []).includes(address.replace(/\D/g, '')),
    index.links.get(cellKey(sheet, address)) || [],
  ]);
}
export function currentCoverage(controller, index, sheet, address) {
  const entry = controller.coverage.get(cellKey(sheet, address));
  if (!entry) return null;
  return entry.signature === cellSignature(index, sheet, address) ? entry : null;
}
export function prepareCoverage(index, { sheet, addresses, disposition, role, reason }) {
  if (!dispositions.includes(disposition) || !coverageRoles.includes(role) || !reason.trim())
    throw Error('Choose a coverage classification, source role and a reason.');
  if (!addresses.length || addresses.length > 100)
    throw Error('Select between one and 100 visible source cells.');
  const cells = [...new Set(addresses)].map((a) => {
    const links = index.links.get(cellKey(sheet, a)) || [];
    if (disposition === 'item' && !links.some((r) => r.boundary === 'include'))
      throw Error(
        sheet +
          '!' +
          a +
          ' has no included item association. Map or include its item first, or explain a different classification.',
      );
    return {
      address: a,
      signature: cellSignature(index, sheet, a),
      itemIds:
        disposition === 'item'
          ? links.filter((r) => r.boundary === 'include').map((r) => r.id)
          : [],
    };
  });
  return { sheet, cells, disposition, role, reason: reason.trim() };
}
export function applyCoverage(controller, index, plan) {
  // Validate the entire frozen scope before any mutation; stale batches apply nothing.
  for (const c of plan.cells)
    if (c.signature !== cellSignature(index, plan.sheet, c.address))
      throw Error('The selected source or item mapping changed. Reopen the coverage selection.');
  const fresh = prepareCoverage(index, {
    sheet: plan.sheet,
    addresses: plan.cells.map((c) => c.address),
    disposition: plan.disposition,
    role: plan.role,
    reason: plan.reason,
  });
  const event = controller.coverageEvent(plan.reason);
  for (const c of fresh.cells)
    controller.coverage.set(cellKey(plan.sheet, c.address), {
      ...event,
      signature: c.signature,
      disposition: plan.disposition,
      role: plan.role,
      reason: plan.reason,
      itemIds: c.itemIds,
    });
}
export function coverageStats(controller, index) {
  const stats = index.book.sheets.map((s) => ({
      sheet: s.name,
      total: Object.keys(s.cells).length,
      reviewed: 0,
      stale: 0,
      unresolved: 0,
      hidden: s.hidden || 'visible',
      hiddenRows: (s.hiddenRows || []).length,
    })),
    byName = new Map(stats.map((s) => [s.sheet, s]));
  for (const [k, entry] of controller.coverage) {
    const [sheet, address] = JSON.parse(k),
      s = byName.get(sheet);
    if (!s || !index.sheets.get(sheet).cells[address]) continue;
    if (entry.signature === cellSignature(index, sheet, address)) s.reviewed++;
    else s.stale++;
  }
  for (const s of stats) s.unresolved = s.total - s.reviewed;
  return {
    sheets: stats,
    total: stats.reduce((n, s) => n + s.total, 0),
    reviewed: stats.reduce((n, s) => n + s.reviewed, 0),
    unresolved: stats.reduce((n, s) => n + s.unresolved, 0),
    stale: stats.reduce((n, s) => n + s.stale, 0),
  };
}
export function layoutSignature(controller, index, sheet) {
  const s = index.sheets.get(sheet);
  return serialize([
    sheet,
    s.hidden,
    s.hiddenRows,
    Object.keys(s.cells).map((a) => {
      const d = currentCoverage(controller, index, sheet, a);
      return [a, d ? [d.signature, d.disposition, d.role, d.itemIds, d.reason] : null];
    }),
  ]);
}
export function approveLayout(controller, index, sheet, reason) {
  if (!reason.trim()) throw Error('Explain the source layout and exclusions.');
  const stats = coverageStats(controller, index).sheets.find((s) => s.sheet === sheet);
  if (!stats || stats.unresolved)
    throw Error('Classify all cells on this sheet before confirming its layout.');
  controller.layouts.set(sheet, {
    ...controller.coverageEvent(reason),
    signature: layoutSignature(controller, index, sheet),
    reason: reason.trim(),
  });
}
export function checkCoverage(controller, index, columns = {}) {
  const stats = coverageStats(controller, index),
    errors = [];
  if (stats.unresolved)
    errors.push(stats.unresolved + ' source cells need classification or renewed review.');
  for (const s of index.book.sheets) {
    const approval = controller.layouts.get(s.name);
    if (!approval || approval.signature !== layoutSignature(controller, index, s.name))
      errors.push('Confirm the current layout and exclusions on ' + s.name + '.');
  }
  for (const r of index.records)
    if (r.boundary === 'include') {
      for (const a of r.anchors) {
        const d = currentCoverage(controller, index, r.sheet, a);
        if (d && (d.disposition !== 'item' || !d.itemIds.includes(r.id)))
          errors.push(
            r.sheet +
              '!' +
              a +
              ' anchors an included item and must be classified as linked item evidence.',
          );
      }
      for (const f of [
        ...Object.values(r.values),
        ...Object.entries(r.extras)
          .filter(([name]) => columns[name] === 'approved')
          .map(([, f]) => f),
      ])
        if (f.value && ['accepted', 'edited'].includes(f.status))
          for (const a of f.evidence) {
            const d = currentCoverage(controller, index, r.sheet, a);
            if (d?.disposition === 'excluded')
              errors.push(
                r.sheet +
                  '!' +
                  a +
                  ' is excluded but still supplies an output value. Blank or remap the value, or revise its coverage classification.',
              );
          }
    }
  return [...new Set(errors)];
}
