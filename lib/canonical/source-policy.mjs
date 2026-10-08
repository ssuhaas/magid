const row = (a) => Number(a.replace(/\D/g, '')),
  column = (a) => a.replace(/\d+$/, ''),
  fingerprint = (s, addresses) =>
    JSON.stringify([
      s.name,
      s.hidden,
      s.hiddenRows,
      addresses.map((a) => [a, s.cells[a]?.raw, s.cells[a]?.formula]),
    ]);
export function sourceLayout(sheet) {
  const raw = (a) => sheet.cells[a]?.raw || '';
  if (
    (sheet.name.includes('Bundled Bid-Recurring') ||
      sheet.name.includes('Bundled Bid-Non Recurring')) &&
    /Item Description/i.test(raw('B4')) &&
    /Manufacturer Part/i.test(raw('E4'))
  )
    return { kind: 'tesla', start: 5, description: 'B', header: 4, proof: ['B4', 'E4'] };
  if (
    sheet.name === 'Approved Req' &&
    /description/i.test(raw('D6')) &&
    /quantity/i.test(raw('B6'))
  )
    return { kind: 'daikin', start: 7, description: 'D', header: 6, proof: ['D6', 'B6'] };
  if (/annual/i.test(raw('E17')) && /product|model/i.test(raw('D17')))
    return { kind: 'hyundai', start: 18, description: 'C', header: 17, proof: ['E17', 'D17'] };
  if (
    raw('A1') === 'Item' &&
    raw('B1') === 'Part #' &&
    raw('E1') === 'Part #' &&
    raw('H1') === 'Part #'
  )
    return {
      kind: 'berry',
      start: 3,
      header: 2,
      lanes: Object.keys(sheet.cells)
        .filter((a) => row(a) === 1 && sheet.cells[a].raw === 'Part #' && !sheet.cells[a].formula)
        .map(column),
      proof: [
        'A1',
        ...Object.keys(sheet.cells).filter(
          (a) => row(a) === 1 && sheet.cells[a].raw === 'Part #' && !sheet.cells[a].formula,
        ),
      ],
    };
  return null;
}
export function isSourceHeader(sheet, address) {
  const layout = sourceLayout(sheet),
    n = row(address);
  return (
    !!layout &&
    (n <= layout.header ||
      (layout.kind === 'hyundai' &&
        /annual/i.test(sheet.cells.E26?.raw || '') &&
        /product|model/i.test(sheet.cells.D26?.raw || '') &&
        (n === 25 || n === 26)))
  );
}
export function boundaryRule(record, book) {
  const s = book.sheets.find((s) => s.name === record.sheet);
  if (
    !s ||
    s.hidden !== 'visible' ||
    record.ambiguous ||
    record.anchors.some(
      (a) => !s.cells[a] || s.cells[a].formula || s.hiddenRows?.includes(String(row(a))),
    )
  )
    return null;
  const texts = record.anchors.map((a) => s.cells[a].raw),
    hits = texts.flatMap((t) => [...t.matchAll(/Item\s*#\s*([A-Za-z0-9-]+)/gi)]);
  if (hits.length === 1 && /^\s*[.\-]?\s*Item\s*#/i.test(texts[0]) && record.values.E.value)
    return {
      rule: 'narrative-item-v2',
      reason:
        'One explicit Item # starts this occurrence. Its continuation cells stay with this item; repeated codes are not merged.',
      source: fingerprint(s, record.anchors),
    };
  const layout = sourceLayout(s);
  if (!layout || record.anchors.length !== 1) return null;
  const a = record.anchors[0],
    n = row(a);
  if (n < layout.start || (layout.description && column(a) !== layout.description)) return null;
  if (layout.kind === 'berry' && !layout.lanes.includes(column(a))) return null;
  if (!s.cells[a].raw.trim()) return null;
  return {
    rule: 'labeled-row-v2',
    reason:
      'A populated item cell belongs to a recognized source table. Each source row or lane stays a separate occurrence.',
    source: fingerprint(s, [...layout.proof, a]),
  };
}
export function sourceRole(book, sheetName, address) {
  const s = book.sheets.find((s) => s.name === sheetName),
    layout = s && sourceLayout(s);
  if (layout?.kind === 'tesla') {
    const col = column(address);
    if (col.length > 1 || col >= 'Q') return 'quoted_alternate';
    if (col >= 'J') return 'quoted_exact';
  }
  return 'customer_specification';
}
export function sourceDecision(index, sheet, address) {
  const s = index.sheets.get(sheet),
    c = s.cells[address];
  if (
    c.formula &&
    s.hidden === 'visible' &&
    !s.hiddenRows?.includes(String(row(address))) &&
    sourceLayout(s)?.kind === 'tesla' &&
    column(address) === 'M' &&
    s.cells.M4?.raw === 'Unit of Measure Check' &&
    !s.cells.M4.formula &&
    !s.hiddenRows?.includes('4') &&
    index.records.some(
      (r) =>
        r.sheet === sheet &&
        r.boundary === 'include' &&
        r.anchors.some((a) => row(a) === row(address)),
    )
  )
    return {
      disposition: 'context',
      role: 'quoted_exact',
      itemIds: [],
      reason:
        'Supplier quote-unit check in the explicitly labeled quote lane. Its formula and cached result are not executed or selected as customer quantity evidence.',
    };
  if (c.formula || s.hidden !== 'visible' || s.hiddenRows?.includes(String(row(address))))
    return null;
  const links = index.links.get(JSON.stringify([sheet, address])) || [],
    included = links.filter((r) => r.boundary === 'include'),
    role = sourceRole(index.book, sheet, address);
  if (included.length)
    return {
      disposition: 'item',
      role,
      itemIds: included.map((r) => r.id),
      reason:
        'This original cell is linked to an included source occurrence. Its source lane was checked by the table policy.',
    };
  if (/Item\s*#/i.test(c.raw)) return null;
  const layout = sourceLayout(s),
    n = row(address);
  if (isSourceHeader(s, address))
    return {
      disposition: 'header',
      role,
      itemIds: [],
      reason: 'Verified header region of the recognized source table.',
    };
  if (layout?.kind === 'berry') {
    const allowed = new Set(
      layout.lanes.flatMap((col) => {
        let n = 0;
        for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
        const name = (n) => {
          let result = '';
          for (; n; n = Math.floor((n - 1) / 26))
            result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
          return result;
        };
        return [
          ...(['B', 'E', 'H'].includes(col) ||
          /^(Item|Description)$/i.test(s.cells[name(n - 1) + '1']?.raw || '')
            ? [name(n - 1)]
            : []),
          col,
          ...(['B', 'E'].includes(col) ? [name(n + 1)] : []),
        ];
      }),
    );
    if (!allowed.has(column(address))) return null;
  }
  if (
    layout &&
    index.records.some(
      (r) => r.sheet === sheet && r.boundary === 'include' && r.anchors.some((a) => row(a) === n),
    )
  ) {
    if (layout.description && column(address) === layout.description) return null;
    return {
      disposition: 'context',
      role,
      itemIds: [],
      reason:
        'Adjacent value on an included item row, supplied to extraction for context; not a separate item occurrence.',
    };
  }
  const raw = c.raw.trim();
  if (/^\d+\.\s*Grainger Items$/i.test(raw) || /^(Item|Part #)$/.test(raw))
    return {
      disposition: 'header',
      role: 'context',
      itemIds: [],
      reason: 'Explicit item-list heading.',
    };
  if (/^\s*[.\-]?\s*KEEP AN EYE ON YOUR CURRENT STOCK\s*$/i.test(raw))
    return {
      disposition: 'context',
      role: 'context',
      itemIds: [],
      reason: 'Explicit stock reminder, not an additional product.',
    };
  return null;
}
export function evaluationEligible(record, column, field, book) {
  if (
    !field.value ||
    field.alternatives?.length ||
    /conflict|review again|review this decision again|routing instructions/i.test(field.reason) ||
    !field.evidence.length
  )
    return false;
  const s = book.sheets.find((s) => s.name === record.sheet);
  if (
    !s ||
    s.hidden !== 'visible' ||
    field.evidence.some(
      (a) =>
        !s.cells[a] ||
        s.cells[a].formula ||
        s.hiddenRows?.includes(String(row(a))) ||
        sourceRole(book, s.name, a) !== 'customer_specification',
    )
  )
    return false;
  if (column === 'M') return false;
  return ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].includes(column);
}

/** A contiguous, explicitly labeled category-discount block is not a product table. */
export function isDiscountContext(sheet, address) {
  if (sourceLayout(sheet)?.kind !== 'tesla' || column(address) !== 'B') return false;
  for (let n = row(address); n >= 5; n--) {
    const value = sheet.cells['B' + n]?.raw;
    if (!value || ['D', 'E', 'F', 'G', 'I'].some(c => sheet.cells[c + n]?.raw)) return false;
    if (/^Please provide a Category Discount Rate$/i.test(value.trim())) return true;
  }
  return false;
}
