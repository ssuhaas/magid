import { normalizeUnit } from '../unit-policy.mjs';
import { requestSchema, validateProposal, MAX_REQUEST_BYTES } from './contracts.mjs';
import { makeRecord } from '../workbook.mjs';
import { automaticRule } from '../canonical/automatic.mjs';
import { sourceLayout, isSourceHeader } from '../canonical/source-policy.mjs';
const rowOf = (a) => Number(a.replace(/\D/g, ''));
/** @param {any} book @param {any[]} records @param {{mode?:string,digest?:string,scopeId?:string,sheet?:string,start?:number,end?:number,targeted?:boolean}} options */
export function buildScope(
  book,
  records,
  { mode = 'enrich', digest, scopeId, sheet, start, end, targeted = false } = {},
) {
  const selected = new Map();
  const add = (s, a, eligible = false) => {
    const c = s.cells[a];
    if (!c) return;
    const key = s.name + '!' + a,
      old = selected.get(key);
    selected.set(key, {
      sheet: s.name,
      cell: a,
      raw: c.raw,
      formula: c.formula,
      eligibleAnchor: eligible || !!old?.eligibleAnchor,
      contextRole:
        isSourceHeader(s, a) ||
        (/^(?:Manufacturer Part Number|Annual Volume|Annual Usage|Unit of Measure|# of Pieces in a UoM)$/i.test(
          c.raw.trim(),
        ) &&
          !eligible)
          ? 'header'
          : eligible || old?.eligibleAnchor
            ? 'item'
            : 'context',
    });
  };
  for (const s of book.sheets) {
    const scoped = records.filter((r) => r.sheet === s.name);
    if ((mode === 'discover' && s.name !== sheet) || (mode === 'enrich' && !scoped.length))
      continue;
    const rows = new Set();
    if (mode === 'enrich')
      for (const r of scoped) {
        for (const a of [
          ...r.anchors,
          ...Object.values(r.values).flatMap((f) => f.evidence),
          ...Object.values(r.extras).flatMap((f) => f.evidence),
        ]) {
          add(s, a, r.anchors.includes(a));
          rows.add(rowOf(a));
        }
      }
    else {
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end - start > 100
      )
        throw Error('Select at most 101 source rows for AI item discovery.');
      for (let row = start; row <= end; row++) rows.add(row);
    }
    const header = sourceLayout(s)?.header || 0;
    const isHeading = (raw) =>
      /^(?:\d+\.\s*Grainger Items|Item|Part #|(?:Customer|Manufacturer|Mfr|Mfg)[ ]+(?:Part[ ]*(?:Number|No\.?|#)?|Reference|Name)|Annual (?:Usage|Volume|Quantity)|Unit of Measure|# of Pieces in a UoM)$/i.test(
        raw.trim(),
      );
    const first =
      mode === 'discover' ? start : Math.min(...scoped.flatMap((r) => r.anchors.map(rowOf)));
    for (const a of Object.keys(s.cells)) {
      const row = rowOf(a);
      if (rows.has(row)) add(s, a, true);
      else if (isSourceHeader(s, a) || row <= header || (row < first && isHeading(s.cells[a].raw)))
        add(s, a, false);
    }
  }
  const input = {
    mode,
    digest,
    scopeId,
    cells: [...selected.values()],
    records: records.map((r) => ({
      id: r.id,
      sheet: r.sheet,
      anchors: r.anchors,
      ...(targeted
        ? {
            requestedColumns: Object.entries(r.values)
              .filter(([column, field]) =>
                !['accepted', 'edited', 'blank'].includes(field.status) &&
                !(field.value && automaticRule(r, column, field, book)),
              )
              .map(([column]) => column),
          }
        : {}),
      currentValues: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v.value])),
      currentExtras: Object.fromEntries(
        Object.entries(r.extras).map(([k, v]) => [k, { value: v.value, evidence: v.evidence }]),
      ),
    })),
  };
  if (
    new TextEncoder().encode(JSON.stringify(input)).length > MAX_REQUEST_BYTES ||
    input.cells.length > 900
  )
    throw Error(
      'This source scope is too large for one AI request. Reduce the item range or use manual mapping.',
    );
  return requestSchema.parse(input);
}
export function applyProposal(original, book, input, envelope) {
  if (envelope.digest !== input.digest || envelope.scopeId !== input.scopeId)
    throw Error('AI response belongs to a different source or extraction scope.');
  const proposal = validateProposal(input, envelope.proposal);
  // Verify again against the browser's untouched original workbook, independent of model output.
  for (const item of proposal.items)
    for (const f of [...item.fields, ...item.extras])
      for (const e of f.evidence) {
        const cell = book.sheets.find((s) => s.name === e.sheet)?.cells[e.cell];
        if (!cell?.raw.includes(e.quote))
          throw Error('AI evidence differs from the original uploaded workbook.');
      }
  const names = new Map(
    original.flatMap((r) => Object.keys(r.extras)).map((k) => [k.toLowerCase(), k]),
  );
  const meta = {};
  const notices = [...proposal.warnings];
  function update(r, p) {
    const copy = structuredClone(r);
    for (const f of p.fields) {
      const candidate = {
        value: f.value,
        evidence: [...new Set(f.evidence.map((e) => e.cell))],
        reason: 'AI candidate: ' + f.reason,
        status: 'pending',
        direct: false,
        origin: 'ai',
        quotes: f.evidence,
      };
      const current = copy.values[f.column];
      if (
        (f.column === 'F' && current.origin === 'source_narrative') ||
        (f.column === 'E' && current.origin === 'narrative_product')
      )
        continue;
      if (
        f.column === 'L' &&
        normalizeUnit(f.value) &&
        normalizeUnit(f.value) === normalizeUnit(current.value) &&
        automaticRule(copy, 'L', current, book)?.status === 'auto_accepted'
      )
        continue;
      if (!['pending', 'auto_blank', 'auto_accepted'].includes(current.status)) continue;
      if (!current.value) copy.values[f.column] = candidate;
      else if (current.value === f.value) {
        if (
          (current.direct && current.origin !== 'ai') ||
          automaticRule(copy, f.column, current, book)?.status === 'auto_accepted'
        )
          continue;
        candidate.reason = (current.reason + ' ' + candidate.reason).slice(0, 2200);
        candidate.evidence = [...new Set([...current.evidence, ...candidate.evidence])];
        copy.values[f.column] = candidate;
      } else if (
        ['E', 'F'].includes(f.column) &&
        !current.direct &&
        current.origin !== 'ai' &&
        !current.alternatives?.length
      ) {
        copy.values[f.column] = candidate;
      } else {
        current.status = 'pending';
        current.alternatives = [...(current.alternatives || []), candidate];
        current.direct = false;
        current.reason += ' AI suggests a different value; compare both sources before deciding.';
      }
    }
    for (const rawExtra of p.extras) {
      const canonical = names.get(rawExtra.name.trim().toLowerCase()) || rawExtra.name.trim();
      names.set(canonical.toLowerCase(), canonical);
      const e = { ...rawExtra, name: canonical };
      const candidate = {
        value: e.value,
        evidence: [...new Set(e.evidence.map((v) => v.cell))],
        reason: 'AI proposal: ' + e.reason,
        status: 'pending',
        origin: 'ai',
        quotes: e.evidence,
      };
      meta[e.name] = { meaning: e.meaning, benefit: e.benefit };
      if (!copy.extras[e.name]) copy.extras[e.name] = candidate;
      else if (copy.extras[e.name].status === 'pending' && copy.extras[e.name].value !== e.value) {
        copy.extras[e.name].alternatives = [...(copy.extras[e.name].alternatives || []), candidate];
        notices.push('A competing extra-column value remains for individual review: ' + e.name);
      }
    }
    return copy;
  }
  if (input.mode === 'enrich')
    return {
      records: original.map((r) => {
        const p = proposal.items.find((p) => p.recordId === r.id);
        return p ? update(r, p) : r;
      }),
      meta,
      notices,
    };
  return {
    records: proposal.items.map((p) => {
      const s = book.sheets.find((s) => s.name === p.sheet);
      const r = makeRecord(s, p.anchors, p.section);
      r.boundaryReason = 'AI boundary candidate: ' + p.boundaryReason;
      r.ambiguous = p.ambiguous;
      return update(r, p);
    }),
    meta,
    notices,
  };
}

/** @param {any[]} records @param {any[]} issues @param {any} book */
export function applyExtractionIssues(records, issues, book = null) {
  for (const issue of issues || []) {
    if (!issue.column) continue;
    const r = records.find(
      (r) =>
        r.id === issue.recordId &&
        r.sheet === issue.sheet &&
        JSON.stringify(r.anchors) === JSON.stringify(issue.anchors),
    );
    const f = r?.values[issue.column];
    if (!f || ['accepted', 'edited', 'blank'].includes(f.status)) continue;
    if (book && !f.value && automaticRule(r, issue.column, f, book)?.status === 'auto_blank')
      continue;
    if (book && f.value && automaticRule(r, issue.column, f, book)?.status === 'auto_accepted')
      continue;
    f.status = 'pending';
    f.direct = false;
    f.reason = 'Evaluator requires review: ' + issue.reason;
    f.evidence = [...new Set([...f.evidence, ...r.anchors])];
  }
  return records;
}
