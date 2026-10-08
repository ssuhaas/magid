import { sourceDate } from './date-policy.mjs';
import { sourceLayout, isDiscountContext } from './canonical/source-policy.mjs';
import { precisionProblem, packagingConflict } from './canonical/source-facts.mjs';
import { hasMatchingIdentity } from './canonical/identity.mjs';
import { normalizeUnit } from './unit-policy.mjs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { identifierLoss } from './identifier-retention.mjs';
import { fieldContracts, assertTemplateContract } from './canonical/field-contracts.mjs';
import { notify } from './debug/trace.mjs';

export const fields = Object.fromEntries(
  Object.entries(fieldContracts)
    .filter(([column]) => column !== 'A')
    .map(([column, contract]) => [column, contract.label]),
);
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const list = (doc, name) => Array.from(doc.getElementsByTagNameNS('*', name));
const xml = (text) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('XML entities and DTDs are unsupported.');
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (list(d, 'parsererror').length) throw Error('Malformed workbook XML.');
  return d;
};
const text = (n) => n?.textContent || '';
export const colName = (n) => {
  let s = '';
  for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function openZip(bytes) {
  if (bytes.length > 20 * 1024 * 1024) throw Error('Maximum upload is 20 MiB.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  if (e < 0) throw Error('Not a readable Excel OOXML ZIP container.');
  const count = v.getUint16(e + 10, true);
  if (count > 10000 || count === 65535) throw Error('Too many ZIP members or unsupported ZIP64.');
  let p = v.getUint32(e + 16, true),
    total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50)
      throw Error('Corrupt ZIP directory.');
    if (v.getUint16(p + 8, true) & 1) throw Error('Encrypted files are unsupported.');
    total += v.getUint32(p + 24, true);
    if (total > 200 * 1024 * 1024) throw Error('Workbook exceeds 200 MiB expanded limit.');
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  const entries = unzipSync(bytes);
  if (!entries['xl/workbook.xml']) throw Error('An .xlsx or .xlsm workbook is required.');
  return entries;
}
export function readWorkbook(bytes, filename = '') {
  const entries = openZip(bytes);
  const contentTypes = entries['[Content_Types].xml']
    ? strFromU8(entries['[Content_Types].xml'])
    : '';
  if (!contentTypes) throw Error('Workbook content types are missing.');
  if (filename && /\.xlsm$/i.test(filename) !== /macroEnabled\.main/i.test(contentTypes))
    throw Error('Filename extension does not match the workbook container type.');
  const book = xml(strFromU8(entries['xl/workbook.xml'])),
    rels = xml(strFromU8(entries['xl/_rels/workbook.xml.rels']));
  const links = Object.fromEntries(
    list(rels, 'Relationship')
      .filter((r) => r.getAttribute('TargetMode') !== 'External')
      .map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]),
  );
  const shared = entries['xl/sharedStrings.xml']
    ? list(xml(strFromU8(entries['xl/sharedStrings.xml'])), 'si').map((n) =>
        list(n, 't').map(text).join(''),
      )
    : [];
  const builtIn = {
    14: 'mm-dd-yy',
    15: 'd-mmm-yy',
    16: 'd-mmm',
    17: 'mmm-yy',
    18: 'h:mm AM/PM',
    19: 'h:mm:ss AM/PM',
    20: 'h:mm',
    21: 'h:mm:ss',
    22: 'm/d/yy h:mm',
  };
  const styles = entries['xl/styles.xml'] ? xml(strFromU8(entries['xl/styles.xml'])) : null,
    formats = {
      ...builtIn,
      ...Object.fromEntries(
        styles
          ? list(styles, 'numFmt').map((n) => [
              n.getAttribute('numFmtId'),
              n.getAttribute('formatCode'),
            ])
          : [],
      ),
    },
    xfs = styles ? list(list(styles, 'cellXfs')[0], 'xf') : [],
    date1904 = ['1', 'true'].includes(list(book, 'workbookPr')[0]?.getAttribute('date1904'));
  let population = 0;
  const sheets = list(book, 'sheet').map((s) => {
    const target = links[s.getAttribute('r:id')];
    if (!target) throw Error('Missing internal worksheet relationship.');
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (!entries[path]) throw Error('Missing worksheet data.');
    const d = xml(strFromU8(entries[path]));
    const cells = {};
    for (const c of list(d, 'c')) {
      const a = c.getAttribute('r'),
        type = c.getAttribute('t') || 'n',
        f = list(c, 'f')[0];
      let raw = type === 'inlineStr' ? list(c, 't').map(text).join('') : text(list(c, 'v')[0]);
      if (type === 's') raw = shared[Number(raw)] ?? '';
      if (raw !== '' || f) {
        population++;
        if (population > 1000000) throw Error('More than 1 million populated cells.');
        const numberFormat =
          formats[xfs[Number(c.getAttribute('s') || 0)]?.getAttribute('numFmtId')] || null;
        cells[a] = {
          raw,
          type,
          formula: f ? text(f) || '[unresolved shared formula]' : null,
          numberFormat,
        };
        const readable = sourceDate(cells[a], date1904);
        if (readable) cells[a].displayedText = readable;
      }
    }
    return {
      name: s.getAttribute('name'),
      hidden: s.getAttribute('state') || 'visible',
      path,
      cells,
      hiddenRows: list(d, 'row')
        .filter((r) => r.getAttribute('hidden') === '1')
        .map((r) => r.getAttribute('r')),
    };
  });
  if (sheets.length > 50) throw Error('Maximum 50 worksheets.');
  return { sheets, population, date1904 };
}

export function makeRecord(sheet, anchors, section = '') {
  return {
    id: crypto.randomUUID(),
    sheet: sheet.name,
    anchors,
    section,
    boundary: 'pending',
    boundaryReason: 'Confirm this source occurrence is one item. Repeated codes remain separate.',
    values: Object.fromEntries(
      Object.keys(fields).map((k) => [
        k,
        {
          value: '',
          evidence: [],
          reason:
            'No explicit mapped source fact. The output remains blank unless supported information is added.',
          status: 'pending',
          direct: false,
        },
      ]),
    ),
    extras: {},
  };
}
function put(r, k, raw, cells, reason = 'Direct value from a labeled source cell.', direct = true) {
  r.values[k] = {
    value: ['I', 'J'].includes(k) ? String(raw ?? '').trim() : String(raw ?? ''),
    evidence: cells,
    reason,
    status: 'pending',
    direct,
  };
}
function extra(r, name, raw, evidence, reason) {
  if (raw !== undefined && raw !== '')
    r.extras[name] = { value: String(raw), evidence, reason, status: 'pending' };
}
function productID(r, raw, a) {
  extra(
    r,
    'Source Product ID',
    raw,
    [a],
    'Preserves the supplied code without falsely labeling it a manufacturer part number.',
  );
}
function uom(r, raw, a) {
  const known = normalizeUnit(raw);
  put(
    r,
    'L',
    known || raw,
    [a],
    known
      ? 'Standalone unit alias; no pack count inferred.'
      : 'Unfamiliar or composite unit: preserve the source spelling and review its meaning.',
    !!known,
  );
  const m = String(raw).match(/^(\d+)\s*(PR)?\/(BX|BG|DZ)$/i);
  if (m) {
    put(
      r,
      'M',
      m[1],
      [a],
      'Lexical packaging count; reviewer must confirm its relationship to the annual volume and container.',
      false,
    );
    put(
      r,
      'L',
      m[3].toUpperCase(),
      [a],
      'Candidate container from a composite unit. Confirm the relationship before acceptance.',
      false,
    );
    if (m[2])
      extra(
        r,
        'Source Packaging',
        String(raw),
        [a],
        'Preserves the explicit content unit: ' +
          m[1] +
          ' pairs per ' +
          m[3] +
          '. Qty/UOM alone cannot distinguish pairs from pieces; approve this column once to retain the original packaging expression.',
      );
  }
}

/** Iterate actual source rows, including extensions, without walking sparse Excel gaps. */
const populatedRows = (cells, column, start) => Object.keys(cells)
  .filter(a => a.replace(/\d+$/, '') === column)
  .map(a => Number(a.replace(/\D/g, '')))
  .filter(n => n >= start)
  .sort((a, b) => a - b);

export function extract(workbook) {
  const records = [],
    warnings = [];
  let profile = 'Manual column mapping';
  for (const s of workbook.sheets) {
    const c = s.cells,
      raw = (a) => c[a]?.raw;
    if (
      (s.name.includes('Bundled Bid-Recurring') || s.name.includes('Bundled Bid-Non Recurring')) &&
      /Item Description/i.test(raw('B4') || '') &&
      /Manufacturer Part/i.test(raw('E4') || '')
    ) {
      profile = 'Tesla labeled product tables';
      for (const n of populatedRows(c, 'B', 5)) {
        if (!raw('B' + n) || isDiscountContext(s, 'B' + n) ||
            /^Item Description$/i.test(raw('B' + n).trim())) continue;
        const r = makeRecord(s, ['B' + n], s.name);
        for (const [k, src] of [
          ['E', 'B'],
          ['D', 'C'],
          ['H', 'D'],
          ['I', 'E'],
          ['K', 'I'],
          ['M', 'G'],
        ])
          if (raw(src + n) !== undefined) put(r, k, raw(src + n), [src + n]);
        if (raw('F' + n)) uom(r, raw('F' + n), 'F' + n);
        if (/^xx\b/i.test(r.values.H.value)) {
          r.values.H.direct = false;
          r.values.H.reason =
            'This manufacturer cell contains supplier routing instructions; review a clean manufacturer name or leave blank.';
        }
        const conflict = packagingConflict(r, workbook);
        if (conflict) {
          r.values.M.direct = false;
          r.values.M.reason = conflict;
          r.values.M.evidence = ['B' + n, 'F' + n, 'G' + n];
        }
        records.push(r);
      }
      warnings.push(
        'Product regions only. Review all other sheets, quote/alternate columns and post-table notes in source coverage.',
      );
      continue;
    }
    if (
      s.name === 'Approved Req' &&
      /description/i.test(raw('D6') || '') &&
      /quantity/i.test(raw('B6') || '')
    ) {
      profile = 'Daikin dated occurrences';
      for (const n of populatedRows(c, 'D', 7)) {
        if (!raw('D' + n)) continue;
        const r = makeRecord(s, ['D' + n]);
        put(r, 'E', raw('D' + n), ['D' + n]);
        if (raw('E' + n)) put(r, 'D', raw('E' + n), ['E' + n]);
        if (raw('G' + n)) uom(r, raw('G' + n), 'G' + n);
        productID(r, raw('C' + n), 'C' + n);
        extra(
          r,
          'Source Quantity',
          raw('B' + n),
          ['B' + n],
          'Quantity is not labeled annual. Preserve it separately; do not annualize or sum repeated occurrences.',
        );
        const readableDate = sourceDate(c['J' + n], workbook.date1904);
        extra(
          r,
          'Source Date',
          readableDate || raw('J' + n),
          ['J' + n],
          readableDate
            ? 'Readable date from the workbook’s explicit date format and date system. The original stored value stays linked as evidence.'
            : 'Preserves the source date text exactly; no locale or missing year is guessed.',
        );
        if (readableDate) r.extras['Source Date'].origin = 'source_date';
        records.push(r);
      }
      warnings.push(
        'Repeated product codes remain distinct. Quantity period is unresolved; Annual Usage stays blank.',
      );
      continue;
    }
    if (/annual/i.test(raw('E17') || '') && /product|model/i.test(raw('D17') || '')) {
      profile = 'Hyundai purchasing sections';
      for (const n of populatedRows(c, 'C', 18).filter(n => n < 24 || n >= 27)) {
        if (!raw('C' + n)) continue;
        const r = makeRecord(s, ['C' + n], n < 24 ? 'Vending' : 'Regular purchasing');
        put(r, 'E', raw('C' + n), ['C' + n]);
        if (raw('E' + n) !== undefined) put(r, 'K', raw('E' + n), ['E' + n]);
        if (raw('B' + n)) put(r, 'D', raw('B' + n), ['B' + n]);
        productID(r, raw('D' + n), 'D' + n);
        if (raw('G' + n)) uom(r, raw('G' + n), 'G' + n);
        extra(
          r,
          'Source Section',
          raw(n < 24 ? 'C16' : 'C25'),
          [n < 24 ? 'C16' : 'C25'],
          'Keeps purchasing sections distinct for repeated source product codes.',
        );
        records.push(r);
      }
      warnings.push(
        'Source says 46 regular items; 30 populated regular rows were observed in the sample. Reconcile actual coverage without inventing rows.',
      );
      continue;
    }
    if (
      raw('A1') === 'Item' &&
      raw('B1') === 'Part #' &&
      raw('E1') === 'Part #' &&
      raw('H1') === 'Part #'
    ) {
      profile = 'Berry parallel lists';
      for (const [dc, ic, end] of sourceLayout(s).lanes.map((ic) => {
        let ix = 0;
        for (const ch of ic) ix = ix * 26 + ch.charCodeAt(0) - 64;
        return [
          colName(ix - 1),
          ic,
          Math.max(
            2,
            ...Object.keys(c)
              .filter((a) => [colName(ix - 1), ic].includes(a.replace(/\d+$/, '')))
              .map((a) => Number(a.replace(/\D/g, ''))),
          ) + 1,
        ];
      })) {
        const canDescribe =
          ['B', 'E', 'H'].includes(ic) || /^(Item|Description)$/i.test(raw(dc + '1') || '');
        let heading = '',
          ha = '';
        for (let n = 3; n < end; n++) {
          if ((dc === 'D' && n >= 35 && n <= 38) || (dc === 'G' && n >= 25 && n <= 29)) {
            if (n === (dc === 'D' ? 35 : 25)) {
              const anchors = Object.keys(c).filter((a) => {
                const q = Number(a.replace(/\D/g, ''));
                return dc === 'D'
                  ? /^[DEF]/.test(a) && q >= 35 && q <= 38
                  : /^[GH]/.test(a) && q >= 25 && q <= 29;
              });
              const r = makeRecord(s, anchors);
              r.boundaryReason =
                'Ambiguous item group: source does not label relationships among these codes. Split into source-backed items or explicitly resolve the group.';
              r.ambiguous = true;
              extra(
                r,
                'Source Product ID',
                anchors.map((a) => raw(a)).join(' | '),
                anchors,
                'All source codes preserved pending item-boundary review.',
              );
              records.push(r);
            }
            continue;
          }
          if (canDescribe && raw(dc + n) && !raw(ic + n)) {
            heading = raw(dc + n);
            ha = dc + n;
          }
          if (!raw(ic + n) || raw(ic + n) === 'Part #') continue;
          const r = makeRecord(s, [ic + n]);
          productID(r, raw(ic + n), ic + n);
          if (heading) put(r, 'D', heading, [ha]);
          if (canDescribe && raw(dc + n)) put(r, 'E', raw(dc + n), [dc + n]);
          const adjacent = (dc === 'A' ? 'C' : dc === 'D' ? 'F' : '') + n;
          if (raw(adjacent))
            extra(
              r,
              'Additional Source Code',
              raw(adjacent),
              [adjacent],
              'Unlabeled adjacent code: review whether it is an alternate, manufacturer code or separate item.',
            );
          records.push(r);
        }
      }
      warnings.push(
        'Two source groups have ambiguous item boundaries; the final count depends on review.',
      );
      continue;
    }
    if (Object.values(c).some((v) => /Item\s*#/i.test(v.raw))) {
      profile = 'Narrative item references';
      let r;
      for (const [a, v] of Object.entries(c).sort(
        (x, y) => Number(x[0].replace(/\D/g, '')) - Number(y[0].replace(/\D/g, '')),
      )) {
        const m = v.raw.match(/Item\s*#\s*([A-Za-z0-9-]+)/i);
        if (m) {
          r = makeRecord(s, [a]);
          productID(r, m[1], a);
          put(
            r,
            'E',
            v.raw,
            [a],
            'Narrative includes purchasing notes. Review product wording, size and packaging; no annualized quantities.',
            false,
          );
          records.push(r);
        } else if (r && a !== 'A39' && a !== 'A1') {
          r.anchors.push(a);
          r.values.E.value += ' ' + v.raw;
          r.values.E.evidence.push(a);
        }
      }
      warnings.push(
        'Narrative text requires semantic review. Purchasing rates and ranges are not annual usage.',
      );
    }
  }
  if (records.length > 2000) throw Error('More than 2,000 output items.');
  return { records, warnings: [...new Set(warnings)], profile };
}

export function mapRows(workbook, sheetName, start, end, mapping) {
  const s = workbook.sheets.find((s) => s.name === sheetName);
  if (!s) throw Error('Choose a source sheet.');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end - start >= 2000
  )
    throw Error('Choose up to 2,000 source rows.');
  const records = [];
  for (let n = start; n <= end; n++) {
    if (!Object.values(mapping).some((col) => s.cells[col + n]?.raw)) continue;
    const r = makeRecord(
      s,
      Object.values(mapping)
        .map((col) => col + n)
        .filter((a) => s.cells[a]),
    );
    for (const [k, col] of Object.entries(mapping)) {
      if (!/^[A-Z]{1,3}$/.test(col) || !fields[k]) continue;
      if (s.cells[col + n])
        put(
          r,
          k,
          s.cells[col + n].raw,
          [col + n],
          'Reviewer-configured column mapping. Confirm source meaning and any formula.',
          false,
        );
    }
    records.push(r);
  }
  return records;
}

/** @param {any[]} records @param {Record<string,string>} columns @param {boolean} coverage @param {any} book */
export function checkReady(records, columns, coverage, book = null) {
  const errors = [];
  const lost = identifierLoss(records, columns);
  if (lost.length)
    errors.push(
      `Preserve source product codes for ${lost.length} item${lost.length === 1 ? '' : 's'} in a description or an approved Source Product ID column before exporting.`,
    );
  if (!records.some((r) => r.boundary !== 'exclude')) errors.push('No included item records.');
  if (!coverage)
    errors.push(
      'Review the full workbook coverage, hidden content, exclusions and item boundaries.',
    );
  for (const r of records) {
    if (r.boundary === 'pending') errors.push('Resolve all item boundaries.');
    if (r.boundary === 'exclude') continue;
    for (const [k, f] of Object.entries(r.values)) {
      if (f.status === 'pending')
        errors.push(
          'Review the remaining interpretations and conflicts, or deliberately leave them blank.',
        );
      if (f.value.length > 32767) errors.push('Excel cell text exceeds 32,767 characters.');
      if (k === 'K' && precisionProblem(f.value))
        errors.push(
          `${r.sheet}!${f.evidence.join(', ') || r.anchors.join(', ')} — ${precisionProblem(f.value)}`,
        );
      if (
        f.value &&
        ['K', 'M'].includes(k) &&
        (!/^\d+(\.\d+)?$/.test(f.value) || !Number.isFinite(Number(f.value)))
      )
        errors.push('Annual usage and Qty/UOM need nonnegative numeric scalars or blank.');
      if (
        k === 'M' &&
        f.value &&
        (Number(f.value) < 1 || Number(f.value) > 50000 || !Number.isInteger(Number(f.value)))
      )
        errors.push('Qty/UOM must be an integer between 1 and 50,000.');
    }
    const pairSources =
      (r.values.M.value &&
        r.values.M.evidence
          .map((a) => book?.sheets.find((s) => s.name === r.sheet)?.cells[a]?.raw || '')
          .filter((v) => /^\d+\s*PR\/(BX|BG|DZ)$/i.test(v.trim()))) ||
      [];
    for (const expression of pairSources) {
      const retained = [
        r.values.E.value,
        r.values.F.value,
        ...Object.entries(r.extras)
          .filter(([name]) => columns[name] === 'approved')
          .map(([, f]) => f.value),
      ].some((v) => v.includes(expression));
      if (!retained)
        errors.push(
          `${r.sheet}!${r.values.M.evidence.join(', ')} — Retain "${expression}" in the approved Source Packaging column or a description, or leave Qty/UOM blank. The output must distinguish pairs from pieces.`,
        );
    }
    if (!hasMatchingIdentity(r, columns, book))
      errors.push(
        'Each included item needs a supported template identity or one verified stock code in the approved Source Product ID column. Resolve ambiguous code relationships before exporting.',
      );
    for (const [name, e] of Object.entries(r.extras))
      if (columns[name] === 'approved') {
        if (e.status === 'pending') errors.push('Review values for approved extra columns.');
        if (e.value.length > 32767) errors.push('Excel cell text exceeds 32,767 characters.');
      }
  }
  const pendingColumns = Object.values(columns).filter((status) => status === 'pending').length;
  if (pendingColumns)
    errors.push(
      `Approve or decline ${pendingColumns} proposed additional column${pendingColumns === 1 ? '' : 's'}.`,
    );
  return [...new Set(errors)];
}
export function exportWorkbook(template, records, columns, observer) {
  const files = openZip(template),
    wb = readWorkbook(template),
    sheet = assertTemplateContract(wb);
  const doc = xml(strFromU8(files[sheet.path])),
    data = list(doc, 'sheetData')[0];
  if (!data) throw Error('Missing template data.');
  const originalRows = list(data, 'row'),
    styles = {};
  for (const row of originalRows)
    for (const c of list(row, 'c'))
      if (c.getAttribute('s')) styles[c.getAttribute('r')] = c.getAttribute('s');
  for (const row of originalRows) if (row.getAttribute('r') !== '1') data.removeChild(row);
  notify(observer, {
    stage: 'export',
    status: 'passed',
    message: 'Original template contract verified.',
  });
  const included = records.filter((r) => r.boundary === 'include');
  if (included.length > 2000) throw Error('Maximum 2,000 items.');
  const extras = Object.keys(columns).filter((k) => columns[k] === 'approved');
  const matrix = [];
  function cell(row, a, value, numeric = false) {
    if (value === '' || value === null || value === undefined) return;
    const c = doc.createElementNS(ns, 'c');
    c.setAttribute('r', a);
    const style = styles[a] || styles[a.replace(/\d+$/, '2')];
    if (style) c.setAttribute('s', style);
    if (numeric) {
      const v = doc.createElementNS(ns, 'v');
      v.textContent = String(value);
      c.appendChild(v);
    } else {
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(ns, 'is'),
        t = doc.createElementNS(ns, 't');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = String(value);
      is.appendChild(t);
      c.appendChild(is);
    }
    row.appendChild(c);
  }
  const header = originalRows[0];
  extras.forEach((name, i) => cell(header, colName(14 + i) + '1', name));
  included.forEach((r, i) => {
    const row = doc.createElementNS(ns, 'row');
    row.setAttribute('r', String(i + 2));
    const values = {
      A: String(i + 1),
      ...Object.fromEntries(Object.entries(r.values).map(([k, f]) => [k, f.value])),
      ...Object.fromEntries(
        extras.map((name, j) => [colName(14 + j), r.extras[name]?.value || '']),
      ),
    };
    for (const [k, v] of Object.entries(values))
      cell(row, k + (i + 2), v, ['A', 'K', 'M'].includes(k) && v !== '');
    data.appendChild(row);
    matrix.push(values);
  });
  const last = colName(13 + extras.length),
    bottom = Math.max(2, included.length + 1);
  for (const dim of list(doc, 'dimension')) dim.setAttribute('ref', `A1:${last}${bottom}`);
  for (const filter of list(doc, 'autoFilter')) filter.setAttribute('ref', `A1:${last}${bottom}`);
  files[sheet.path] = strToU8(new XMLSerializer().serializeToString(doc));
  const result = zipSync(files),
    readback = readWorkbook(result).sheets.find((s) => s.name === sheet.name);
  matrix.forEach((row, i) => {
    for (const [k, v] of Object.entries(row)) {
      const c = readback.cells[k + (i + 2)];
      if ((c?.raw || '') !== v || c?.formula)
        throw Error('Excel readback failed at ' + k + (i + 2));
    }
  });
  for (const other of wb.sheets.filter((s) => s.path !== sheet.path))
    if (strFromU8(files[other.path]) !== strFromU8(openZip(template)[other.path]))
      throw Error('Other template worksheet changed.');
  notify(observer, {
    stage: 'export',
    status: 'passed',
    message: 'Excel readback and other worksheet preservation verified.',
    detail: { rows: included.length, columns: 13 + extras.length },
  });
  return result;
}
