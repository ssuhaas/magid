import { sourceLayout, sourceRole } from './source-policy.mjs';
const row = (a) => Number(a.replace(/\D/g, ''));
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
};
const fraction = (n, d = 1n) => {
  if (!d) throw Error('Division by zero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  n /= g;
  d /= g;
  if (n.toString().length + d.toString().length > 200)
    throw Error('Calculation exceeds the verification bounds.');
  return { n, d };
};
const decimal = (t) => {
  if (!/^\d+(?:\.\d+)?$/.test(t)) throw Error('A plain decimal is required.');
  const [a, b = ''] = t.split('.');
  return fraction(BigInt(a + b), 10n ** BigInt(b.length));
};
/** Exact bounded arithmetic only. Never execute workbook text, references, functions or external links. */
export function verifyConstantFormula(expression, cached) {
  try {
    const text = String(expression).replace(/^=/, '');
    if (text.length > 200 || !/^[\d\s.+*/()\-]+$/.test(text))
      throw Error(
        'Only arithmetic with numeric constants can be independently verified here. Cell references and Excel functions need separate source review.',
      );
    const tokens = text.match(/\d+(?:\.\d+)?|[()+*/-]/g) || [];
    if (!tokens.length || tokens.length > 64 || tokens.join('') !== text.replace(/\s/g, ''))
      throw Error('Unsupported arithmetic syntax.');
    let i = 0;
    const op = (a, b, s) =>
      s === '+'
        ? fraction(a.n * b.d + b.n * a.d, a.d * b.d)
        : s === '-'
          ? fraction(a.n * b.d - b.n * a.d, a.d * b.d)
          : s === '*'
            ? fraction(a.n * b.n, a.d * b.d)
            : fraction(a.n * b.d, a.d * b.n);
    function atom() {
      const t = tokens[i++];
      if (t === '+' || t === '-') {
        const a = atom();
        return t === '-' ? fraction(-a.n, a.d) : a;
      }
      if (t === '(') {
        const a = sum();
        if (tokens[i++] !== ')') throw Error('Unbalanced parentheses.');
        return a;
      }
      if (!t) throw Error('Incomplete expression.');
      return decimal(t);
    }
    function product() {
      let a = atom();
      while (['*', '/'].includes(tokens[i])) {
        const s = tokens[i++];
        a = op(a, atom(), s);
      }
      return a;
    }
    function sum() {
      let a = product();
      while (['+', '-'].includes(tokens[i])) {
        const s = tokens[i++];
        a = op(a, product(), s);
      }
      return a;
    }
    const value = sum();
    if (i !== tokens.length || value.n < 0n)
      throw Error('A complete nonnegative quantity is required.');
    let d = value.d;
    for (const prime of [2n, 5n]) while (d % prime === 0n) d /= prime;
    if (d !== 1n) throw Error('The result requires rounding; it is not verified automatically.');
    let scale = 0,
      power = 1n;
    while (power % value.d !== 0n && scale < 16) {
      power *= 10n;
      scale++;
    }
    if (power % value.d !== 0n) throw Error('Too many decimal places.');
    const digits = ((value.n * power) / value.d).toString().padStart(scale + 1, '0');
    let result = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
    result = result.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    if (result.replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15)
      throw Error('Result exceeds reliable Excel precision.');
    const saved = decimal(String(cached));
    if (value.n !== saved.n || value.d !== saved.d)
      throw Error('Independent calculation differs from Excel’s saved result.');
    return {
      ok: true,
      result,
      expression: String(expression),
      cached: String(cached),
      reason:
        'Numeric-only arithmetic matches the saved result exactly. Annual period and purchasing unit still need confirmation.',
    };
  } catch (e) {
    return { ok: false, reason: e.message, expression: String(expression), cached: String(cached) };
  }
}
export function annualSource(record, book) {
  const s = book?.sheets.find((s) => s.name === record.sheet),
    layout = s && sourceLayout(s),
    f = record.values.K,
    n = row(record.anchors[0] || '');
  const address = layout?.kind === 'hyundai' ? 'E' + n : layout?.kind === 'tesla' ? 'I' + n : null,
    header =
      layout?.kind === 'hyundai'
        ? 'E' + (n >= 27 ? 26 : 17)
        : layout?.kind === 'tesla'
          ? 'I4'
          : null;
  if (
    !s ||
    s.hidden !== 'visible' ||
    !address ||
    !f?.value ||
    /conflict/i.test(f.reason || '') ||
    f.alternatives?.length ||
    f.evidence.length !== 1 ||
    f.evidence[0] !== address ||
    s.hiddenRows?.includes(String(n)) ||
    sourceRole(book, s.name, address) !== 'customer_specification' ||
    !s.cells[address] ||
    s.cells[address].raw !== f.value ||
    s.hiddenRows?.includes(String(row(header))) ||
    (layout.kind === 'hyundai' && n >= 27 && !/product|model/i.test(s.cells.D26?.raw || '')) ||
    s.cells[header]?.formula ||
    !/annual|yearly|per year/i.test(s.cells[header]?.raw || '')
  )
    return null;
  return { address, header, heading: s.cells[header].raw, cell: s.cells[address] };
}
export function formulaReview(record, book) {
  const source = annualSource(record, book);
  if (!source?.cell.formula) return null;
  return { ...source, ...verifyConstantFormula(source.cell.formula, source.cell.raw) };
}
export function packagingReview(record, book) {
  const s = book?.sheets.find((s) => s.name === record.sheet),
    f = record.values.M;
  if (
    !s ||
    s.hidden !== 'visible' ||
    !f?.value ||
    f.alternatives?.length ||
    record.values.L.alternatives?.length ||
    /conflict/i.test((f.reason || '') + ' ' + (record.values.L.reason || ''))
  )
    return null;
  const matches = f.evidence
    .map((address) => ({ address, cell: s.cells[address] }))
    .filter(
      (x) =>
        x.cell &&
        !x.cell.formula &&
        !s.hiddenRows?.includes(String(row(x.address))) &&
        record.anchors.some((a) => row(a) === row(x.address)) &&
        sourceRole(book, s.name, x.address) === 'customer_specification',
    )
    .map((x) => ({ ...x, match: /^(\d+)\s*(PR)?\/(BX|BG|DZ)$/i.exec(x.cell.raw.trim()) }))
    .filter((x) => x.match);
  if (matches.length !== 1 || f.evidence.length !== 1) return null;
  const x = matches[0],
    count = Number(x.match[1]),
    container = x.match[3].toUpperCase(),
    content = x.match[2] ? 'PR' : null;
  if (
    count < 1 ||
    count > 50000 ||
    String(count) !== f.value ||
    record.values.L.value !== container
  )
    return null;
  return {
    address: x.address,
    raw: x.cell.raw,
    count,
    container,
    content,
    meta: { address: x.address, raw: x.cell.raw, count, container, content },
    annual: annualSource(record, book),
    formula: formulaReview(record, book),
  };
}
export function confirmPackaging(record, book, keepAnnual) {
  const p = packagingReview(record, book);
  if (!p) throw Error('Packaging evidence changed or is conflicting. Reopen the review.');
  if (
    keepAnnual &&
    (!p.annual ||
      (p.formula && !p.formula.ok) ||
      !/^[0-9]+(?:\.[0-9]+)?$/.test(record.values.K.value))
  )
    throw Error('Annual quantity is not independently verifiable. Leave Annual Usage blank.');
  const r = structuredClone(record),
    reason = `Reviewer confirmed ${p.count} ${p.content === 'PR' ? 'pairs' : 'source-defined contents'} per ${p.container}; no pair-to-piece conversion applied.`;
  r.values.L = {
    ...r.values.L,
    value: p.container,
    evidence: [p.address],
    status: 'accepted',
    reason,
  };
  r.values.M = { ...r.values.M, packReview: p.meta, status: 'accepted', reason };
  r.values.K = {
    ...r.values.K,
    value: keepAnnual ? r.values.K.value : '',
    status: keepAnnual ? 'accepted' : 'blank',
    reason: keepAnnual
      ? 'Reviewer confirmed the source annual quantity counts ' + p.container + ' containers.'
      : 'Reviewer could not confirm the annual purchasing unit and deliberately left Annual Usage blank. No conversion inferred.',
  };
  return r;
}
