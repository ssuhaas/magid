import { identityColumns } from './identity.mjs';
import schema from './reference/canonical.schema.json' with { type: 'json' };
const equal = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
};
const key = (...parts) => JSON.stringify(parts);
const decimalCompare = (a, b) => {
  const [ai, af = ''] = a.split('.'),
    [bi, bf = ''] = b.split('.');
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai > bi ? 1 : -1;
  const n = Math.max(af.length, bf.length),
    x = af.padEnd(n, '0'),
    y = bf.padEnd(n, '0');
  return x === y ? 0 : x > y ? 1 : -1;
};
/** Browser port of the authoritative v1.1 validator. Trust context is a separate controller input. */
export function validate(run, { final = false, trusted = null } = {}) {
  const errors = [],
    fail = (code, path, message) => errors.push({ code, path, message });
  function shape(value, s, path) {
    if (s.$ref) return shape(value, schema.$defs[s.$ref.split('/').at(-1)], path);
    if (s.anyOf) {
      for (const option of s.anyOf) {
        const before = errors.length;
        shape(value, option, path);
        if (errors.length === before) return;
        errors.splice(before);
      }
      fail('SHAPE', path, 'No allowed shape matches');
      return;
    }
    if ('const' in s && !equal(value, s.const)) fail('SHAPE', path, 'Incorrect constant');
    if (s.enum && !s.enum.some((v) => equal(v, value))) fail('SHAPE', path, 'Unknown enum value');
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [],
      matches = {
        object: value !== null && typeof value === 'object' && !Array.isArray(value),
        array: Array.isArray(value),
        string: typeof value === 'string',
        integer: Number.isInteger(value),
        number: typeof value === 'number' && Number.isFinite(value),
        boolean: typeof value === 'boolean',
        null: value === null,
      };
    if (types.length && !types.some((t) => matches[t])) {
      fail('SHAPE', path, 'Invalid type');
      return;
    }
    if (matches.object && s.properties) {
      for (const k of s.required)
        if (!(k in value)) fail('SHAPE', path + '/' + k, 'Required property missing');
      for (const [k, v] of Object.entries(value))
        if (!(k in s.properties)) fail('SHAPE', path + '/' + k, 'Unknown property');
        else shape(v, s.properties[k], path + '/' + k);
    }
    if (matches.array && s.items) value.forEach((v, i) => shape(v, s.items, path + '/' + i));
    if (matches.string) {
      if (Array.from(value).length < (s.minLength || 0)) fail('SHAPE', path, 'Empty text');
      if (s.pattern && !new RegExp('^(?:' + s.pattern + ')(?![\\s\\S])', 'u').test(value))
        fail('SHAPE', path, 'Invalid text syntax');
    }
    if (matches.number && (value < (s.minimum ?? -Infinity) || value > (s.maximum ?? Infinity)))
      fail('SHAPE', path, 'Outside bounds');
  }
  shape(run, schema, '');
  if (errors.length) return errors;
  if (final && !trusted)
    fail(
      'TRUSTED_CONTEXT_REQUIRED',
      '',
      'Final readiness needs an independent inspector snapshot and controller approval registry',
    );
  const index = (rows, id, path) => {
    const m = new Map();
    for (const r of rows) {
      if (m.has(r[id])) fail('DUPLICATE_ID', path, r[id]);
      m.set(r[id], r);
    }
    return m;
  };
  const files = index(run.source_files, 'file_id', '/source_files'),
    ev = index(run.evidence, 'evidence_id', '/evidence'),
    regions = index(run.regions, 'region_id', '/regions'),
    items = index(run.items, 'item_id', '/items'),
    events = index(run.review_events, 'event_id', '/review_events'),
    issues = index(run.issues, 'issue_id', '/issues'),
    candidates = new Map();
  for (const item of items.values())
    for (const d of Object.values(item.fields))
      for (const c of d.candidates) {
        if (candidates.has(c.candidate_id)) fail('DUPLICATE_ID', '/items', c.candidate_id);
        candidates.set(c.candidate_id, c);
      }
  const visiting = new Set(),
    visited = new Set();
  function cycle(id) {
    if (visiting.has(id)) {
      fail('DEPENDENCY_CYCLE', '/candidates', id);
      return;
    }
    if (visited.has(id) || !candidates.has(id)) return;
    visiting.add(id);
    for (const p of candidates.get(id).input_candidate_ids) cycle(p);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of candidates.keys()) cycle(id);
  const refs = (ids, m, path) => {
    for (const id of ids) if (!m.has(id)) fail('MISSING_REFERENCE', path, id);
  };
  const unit = (u, path) => {
    if (u?.code === 'OTHER' && !u.label) fail('UNIT_LABEL_REQUIRED', path, 'OTHER requires label');
  };
  function quantity(q, path) {
    const a = q.amount,
      k = a.kind,
      ok =
        (k === 'scalar' &&
          a.value !== null &&
          a.minimum === null &&
          a.maximum === null &&
          !a.alternatives.length) ||
        (k === 'range' &&
          a.value === null &&
          a.minimum !== null &&
          a.maximum !== null &&
          !a.alternatives.length) ||
        (k === 'alternatives' &&
          a.value === null &&
          a.minimum === null &&
          a.maximum === null &&
          a.alternatives.length >= 2);
    if (!ok) fail('QUANTITY_SHAPE', path, 'Amount branches are mutually exclusive');
    if (
      k === 'range' &&
      a.minimum !== null &&
      a.maximum !== null &&
      decimalCompare(a.minimum, a.maximum) > 0
    )
      fail('QUANTITY_RANGE', path, 'Reversed range');
    unit(q.uom, path);
  }
  const sourceKeys = new Set([...ev.values()].map((e) => key(e.file_id, e.sheet_id, e.range)));
  for (const e of ev.values()) {
    if (
      final &&
      e.formula_verified &&
      !equal(trusted?.formula_approvals?.get(key(e.file_id, e.sheet_id, e.range)), {
        raw: e.raw_value,
        formula: e.formula,
      })
    )
      fail(
        'FORMULA_APPROVAL_UNVERIFIED',
        '/evidence/' + e.evidence_id,
        'Formula proof is missing or stale',
      );
    const f = files.get(e.file_id);
    if (!f || !f.sheets.some((s) => s.sheet_id === e.sheet_id))
      fail('EVIDENCE_SOURCE', '/evidence/' + e.evidence_id, 'Unknown file/sheet');
    const s = e.span;
    if (
      s &&
      (typeof e.raw_value !== 'string' ||
        Array.from(e.raw_value).slice(s.start, s.end).join('') !== s.quoted_text ||
        s.start >= s.end)
    )
      fail('INVALID_SPAN', '/evidence/' + e.evidence_id, 'Span does not match raw text');
  }
  for (const e of events.values()) {
    refs(e.supporting_evidence_ids, ev, '/review_events');
    if (
      e.run_id !== run.run_id ||
      e.resulting_revision !== e.expected_revision + 1 ||
      e.resulting_revision > run.revision
    )
      fail('REVIEW_REVISION', '/review_events', 'Invalid revision/run');
  }
  for (const r of regions.values()) {
    const f = files.get(r.file_id);
    if (!f || !f.sheets.some((s) => s.sheet_id === r.sheet_id))
      fail('REGION_SOURCE', '/regions', r.region_id);
    refs(r.header_evidence_ids, ev, '/regions');
    if (final && (r.resolution === 'unresolved' || !r.approval_ref))
      fail('LAYOUT_UNRESOLVED', '/regions', r.region_id);
    if (final && trusted && !trusted.layout_approvals?.has(r.approval_ref))
      fail('LAYOUT_APPROVAL_UNVERIFIED', '/regions', r.region_id);
    for (const d of r.coverage) {
      refs([d.evidence_id], ev, '/regions/coverage');
      refs(d.item_ids, items, '/regions/coverage');
      if (final && d.disposition === 'unresolved')
        fail('COVERAGE_UNRESOLVED', '/regions', r.region_id);
    }
  }
  const covered = new Set(
    [...regions.values()].flatMap((r) => r.coverage.map((d) => d.evidence_id)),
  );
  if (final)
    for (const id of ev.keys()) if (!covered.has(id)) fail('COVERAGE_MISSING', '/evidence', id);
  for (const i of issues.values()) {
    refs(i.competing_candidate_ids, candidates, '/issues');
    if (
      i.resolution_status === 'resolved' &&
      !i.resolution_rule &&
      !events.has(i.resolving_event_id)
    )
      fail('ISSUE_RESOLUTION', '/issues', i.issue_id);
    if (final && i.severity !== 'info' && i.resolution_status === 'open')
      fail('OPEN_ISSUE', '/issues', i.issue_id);
  }
  for (const item of items.values()) {
    const path = '/items/' + item.item_id,
      region = regions.get(item.lineage.region_id),
      selected = {};
    refs(item.issue_ids, issues, path);
    if (
      !region ||
      region.file_id !== item.lineage.file_id ||
      region.sheet_id !== item.lineage.sheet_id
    )
      fail('ITEM_LINEAGE', path, 'Region source mismatch');
    for (const a of item.lineage.source_ranges)
      if (!sourceKeys.has(key(item.lineage.file_id, item.lineage.sheet_id, a)))
        fail('ITEM_ANCHOR_MISSING', path, a);
    if (final && ['candidate', 'needs_review'].includes(item.inclusion))
      fail('ITEM_UNRESOLVED', path, 'Unresolved inclusion');
    if (item.inclusion === 'excluded' && !item.exclusion_reason)
      fail('EXCLUSION_REASON', path, 'Reason required');
    for (const [field, d] of Object.entries(item.fields)) {
      const fp = path + '/fields/' + field,
        c = d.candidates.find((c) => c.candidate_id === d.selected_candidate_id),
        accepted = ['auto_accepted', 'reviewer_accepted'].includes(d.resolution),
        review = events.get(d.review_event_id);
      if (d.selected_candidate_id !== null && !c)
        fail('SELECTION_INVALID', fp, 'Selection not in field candidates');
      if (accepted && d.presence === 'present' && !c)
        fail('SELECTION_REQUIRED', fp, 'Present accepted fact needs candidate');
      if (
        d.resolution === 'accepted_unknown' &&
        (c || !['absent', 'explicitly_unknown', 'unresolved'].includes(d.presence))
      )
        fail('UNKNOWN_STATE', fp, 'Unknown must not select a fact');
      if (['absent', 'not_applicable'].includes(d.presence) && (c || !d.disposition_reason))
        fail('ABSENCE_STATE', fp, 'Scoped absence reason and no selection required');
      if (accepted && ['unresolved', 'explicitly_unknown'].includes(d.presence))
        fail('DECISION_STATE', fp, 'Unresolved presence cannot accept a value');
      if (d.decision_revision > run.revision) fail('DECISION_REVISION', fp, 'Future decision');
      if (
        ['reviewer_accepted', 'accepted_unknown'].includes(d.resolution) &&
        (!review ||
          (!review.affected_ids.includes(field) && !review.affected_ids.includes(item.item_id)))
      )
        fail('REVIEW_REQUIRED', fp, 'Missing scoped review event');
      if (
        review &&
        d.resolution === 'reviewer_accepted' &&
        (!['accept', 'correct'].includes(review.action) ||
          review.new_candidate_id !== d.selected_candidate_id ||
          review.resulting_revision !== d.decision_revision)
      )
        fail('REVIEW_DECISION_MISMATCH', fp, 'Review event does not approve current decision');
      if (
        review &&
        d.resolution === 'accepted_unknown' &&
        (review.action !== 'accept_unknown' ||
          review.new_candidate_id !== null ||
          review.resulting_revision !== d.decision_revision)
      )
        fail('REVIEW_DECISION_MISMATCH', fp, 'Unknown review event mismatch');
      if (
        d.confidence_assessment.calibrated_probability !== null &&
        !d.confidence_assessment.calibration_version
      )
        fail('CALIBRATION_REQUIRED', fp, 'Calibration version required');
      for (const candidate of d.candidates) {
        refs(candidate.evidence_ids, ev, fp);
        refs(candidate.input_candidate_ids, candidates, fp);
        if (!candidate.evidence_ids.length && candidate.method !== 'reviewer_assertion')
          fail('EVIDENCE_REQUIRED', fp, 'Fact needs source evidence');
        if (candidate.method === 'derived' && !candidate.input_candidate_ids.length)
          fail('DERIVATION_INPUTS', fp, 'Derived fact needs inputs');
        if (field === 'annual_usage') quantity(candidate.value, fp);
        if (field === 'customer_uom') unit(candidate.value, fp);
        if (field === 'pack_quantity') {
          unit(candidate.value.container_uom, fp);
          unit(candidate.value.content_uom, fp);
        }
      }
      if (c && accepted) {
        selected[field] = c.value;
        const sources = c.evidence_ids.map((id) => ev.get(id)).filter(Boolean);
        if (
          c.rule_version === 'join-v1' &&
          (typeof c.value !== 'string' ||
            c.value !== sources.map((e) => String(e.raw_value).trim()).join(' '))
        )
          fail('JOIN_VALUE_MISMATCH', fp, 'Joined narrative differs from ordered source cells');
        if (
          c.method === 'copied' &&
          typeof c.value === 'string' &&
          !sources.some((e) => String(e.raw_value).trim() === c.value)
        )
          fail('COPY_VALUE_MISMATCH', fp, 'Copied text differs from source');
        if (
          final &&
          trusted &&
          !equal(trusted.field_approvals?.get(key(item.item_id, field, c.candidate_id)), c.value)
        )
          fail(
            'FIELD_APPROVAL_UNVERIFIED',
            fp,
            'Mapping and exact value not approved by controller',
          );
        if (
          sources.some(
            (e) =>
              e.semantic_role !== 'customer_specification' ||
              !['customer_input', 'operator_context'].includes(files.get(e.file_id)?.source_role),
          )
        )
          fail('SOURCE_ROLE', fp, 'Non-customer evidence selected');
        if (sources.some((e) => e.formula && !e.formula_verified))
          fail('FORMULA_UNVERIFIED', fp, 'Unverified formula');
        if (
          d.resolution === 'auto_accepted' &&
          (!(c.rule_version === 'evaluated-v2'
            ? ['copied', 'parsed', 'semantic'].includes(c.method) &&
              trusted &&
              equal(
                trusted.evaluated_approvals?.get(key(item.item_id, field, c.candidate_id)),
                c.value,
              )
            : ['copied', 'parsed'].includes(c.method) &&
              [
                'copy-v1',
                'trim-v1',
                'number-v1',
                'unit-alias-v1',
                'join-v1',
                'source-span-v2',
                'labeled-identifier-v1',
                'labeled-pack-v1',
                'labeled-unit-v1',
              ].includes(c.rule_version)) ||
            !region ||
            region.resolution === 'unresolved' ||
            d.review_reason_codes.length)
        )
          fail('AUTO_ACCEPT_FORBIDDEN', fp, 'Not an approved deterministic decision');
        if (d.resolution === 'auto_accepted' && d.candidates.length > 1)
          fail('COMPETING_CANDIDATES', fp, 'Multiple candidates require explicit resolution');
        if (c.method === 'reviewer_assertion' && !review)
          fail('REVIEW_REQUIRED', fp, 'Assertion needs reviewer');
        const namespace = {
          online_bid_sequence: 'online_bid_sequence',
          customer_reference: 'customer_reference',
          manufacturer_part_primary: 'manufacturer_part',
          manufacturer_part_secondary: 'manufacturer_part',
        }[field];
        if (namespace && c.value.namespace !== namespace)
          fail('IDENTIFIER_NAMESPACE', fp, 'Wrong identifier namespace');
      }
      if (
        final &&
        item.inclusion === 'included' &&
        (['unresolved', 'rejected'].includes(d.resolution) || (d.presence === 'present' && !c))
      )
        fail('FIELD_UNRESOLVED', fp, 'No final disposition');
    }
    const q = selected.annual_usage,
      u = selected.customer_uom,
      p = selected.pack_quantity,
      unitEqual = (a, b) => a && b && a.code === b.code && a.label === b.label;
    if (q) {
      if (q.time_basis !== 'annual' || q.amount.kind !== 'scalar')
        fail('ANNUAL_BASIS', path, 'Annual scalar required');
      if (q.uom && u && !unitEqual(q.uom, u))
        fail('QUANTITY_UOM_MISMATCH', path, 'Quantity and output UOM differ');
    }
    if (p) {
      if (p.count === null || p.count > 50000)
        fail('PACK_BOUNDS', path, 'Pack count 1..50000 required');
      if (!unitEqual(p.container_uom, u))
        fail('PACK_UOM_MISMATCH', path, 'Pack container must match L');
    }
    const stockIdentity = run.extensions.some(
      (x) =>
        x.name === 'Source Product ID' &&
        x.status === 'approved' &&
        x.output_position !== null &&
        x.values.some(
          (v) =>
            v.item_id === item.item_id &&
            typeof v.value === 'string' &&
            v.value.length > 0 &&
            trusted?.stock_identity_approvals?.get(item.item_id) === v.value &&
            trusted?.extension_value_approvals?.get(key(x.column_id, item.item_id)) === v.value,
        ),
    );
    if (
      final &&
      item.inclusion === 'included' &&
      !Object.values(identityColumns).some((f) => selected[f]) &&
      !stockIdentity
    )
      fail('IDENTITY_NOT_PROJECTABLE', path, 'No usable projected identity');
    for (const q of item.quantity_observations) quantity(q, path);
  }
  if (final && [...items.values()].filter((i) => i.inclusion === 'included').length > 2000)
    fail('CAPACITY', '/items', 'v1 capacity 2000');
  if (trusted) {
    for (const e of ev.values()) {
      const k = key(e.file_id, e.sheet_id, e.range);
      if (!trusted.cells?.has(k) || !equal(trusted.cells.get(k), e.raw_value))
        fail('SOURCE_VALUE_MISMATCH', '/evidence', e.evidence_id);
    }
    for (const f of files.values())
      if (trusted.file_hashes?.get(f.file_id) !== f.sha256)
        fail('SOURCE_DIGEST_MISMATCH', '/source_files', f.file_id);
    if (
      final &&
      (!trusted.cells ||
        trusted.cells.size !== sourceKeys.size ||
        [...trusted.cells.keys()].some((k) => !sourceKeys.has(k)))
    )
      fail('INSPECTION_COVERAGE_MISMATCH', '/evidence', 'Inspector inventory differs');
    if (final)
      for (const i of items.values())
        for (const [f, d] of Object.entries(i.fields)) {
          if (
            ['reviewer_accepted', 'accepted_unknown'].includes(d.resolution) &&
            !trusted.review_event_ids?.has(d.review_event_id)
          )
            fail('REVIEW_UNVERIFIED', '/items', i.item_id);
          if (
            i.inclusion === 'included' &&
            ['absent', 'not_applicable'].includes(d.presence) &&
            trusted.disposition_approvals?.get(key(i.item_id, f)) !== d.presence
          )
            fail('ABSENCE_UNVERIFIED', '/items', f);
        }
  }
  const names = new Set(),
    positions = new Set();
  for (const x of run.extensions) {
    refs(x.evidence_ids, ev, '/extensions');
    for (const v of x.values) {
      refs([v.item_id], items, '/extensions');
      refs(v.evidence_ids, ev, '/extensions');
      if (
        x.status === 'approved' &&
        final &&
        trusted &&
        !equal(trusted.extension_value_approvals?.get(key(x.column_id, v.item_id)), v.value)
      )
        fail(
          'COLUMN_VALUE_UNVERIFIED',
          '/extensions',
          'Approving a column does not approve inferred values',
        );
    }
    const name = x.name.toLocaleLowerCase();
    if (names.has(name)) fail('COLUMN_NAME_DUPLICATE', '/extensions', x.name);
    names.add(name);
    if (['approved', 'declined'].includes(x.status)) {
      const e = events.get(x.review_event_id),
        action = x.status === 'approved' ? 'approve_column' : 'decline_column';
      if (!e || e.action !== action || !e.affected_ids.includes(x.column_id))
        fail('COLUMN_REVIEW_REQUIRED', '/extensions', x.column_id);
      if (final && trusted && !trusted.review_event_ids?.has(x.review_event_id))
        fail('REVIEW_UNVERIFIED', '/extensions', x.column_id);
    }
    if (x.status === 'approved') {
      if (x.output_position === null || positions.has(x.output_position))
        fail('COLUMN_POSITION', '/extensions', 'Approved positions must be unique');
      positions.add(x.output_position);
    } else if (x.output_position !== null)
      fail('COLUMN_NOT_APPROVED', '/extensions', 'Unapproved column cannot be exported');
    if (x.status === 'declined' && !x.decline_disposition)
      fail('DECLINE_DISPOSITION', '/extensions', 'Document consequences of declining');
    if (final && x.status === 'proposed') fail('COLUMN_PENDING', '/extensions', x.column_id);
  }
  return errors;
}
