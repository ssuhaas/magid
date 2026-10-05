import { labeledPackCount, labeledIdentifier, precisionProblem } from './source-facts.mjs';
import { formulaReview, packagingReview } from './quantity-review.mjs';
import { stockCodeReady } from './identity.mjs';
import { boundaryRule, evaluationEligible } from './source-policy.mjs';
import { automaticRule, automaticExtraRule } from './automatic.mjs';
import { validate } from './validator.mjs';
import { fieldContracts } from './field-contracts.mjs';
import { coverageIndex, currentCoverage, layoutSignature, checkCoverage } from './coverage.mjs';
export const fieldMap = Object.fromEntries(
  Object.entries(fieldContracts)
    .filter(([, contract]) => contract.canonical)
    .map(([column, contract]) => [column, contract.canonical]),
);
const key = (...p) => JSON.stringify(p),
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  confidence = () => ({
    model_score: null,
    calibrated_probability: null,
    calibration_version: null,
  });
const units = new Set(['EA', 'PR', 'DZ', 'BX', 'BG', 'PK', 'CS', 'RL']);
const unit = (raw) => ({
  raw_text: raw || 'Unresolved unit',
  code: units.has(raw) ? raw : 'OTHER',
  label: units.has(raw) ? null : raw || 'Unresolved unit',
});
const numeric = (raw) => {
  if (!/^\d+(\.\d+)?$/.test(raw)) throw Error('A nonnegative decimal scalar is required.');
  return raw.replace(/^0+(?=\d)/, '');
};
const formulaSource = (r, book, proof) =>
  key(
    proof.cell.raw,
    proof.cell.formula,
    proof.header,
    proof.heading,
    ['E', 'F', 'L', 'M'].flatMap((k) =>
      r.values[k].evidence.map((a) => [a, book.sheets.find((s) => s.name === r.sheet)?.cells[a]]),
    ),
  );
const basis = (f) => key(f.value, f.evidence, f.quotes || [], f.origin || '', f.packReview || null);
const dependencies = {
  G: ['E', 'F'],
  H: ['E', 'F'],
  I: ['H', 'E', 'F'],
  J: ['H', 'E', 'F'],
  K: ['L', 'M', 'E', 'F'],
  L: ['E', 'F'],
  M: ['L', 'K', 'E', 'F'],
};
const signature = (r, f, column) =>
  key(
    r.sheet,
    r.anchors,
    r.section,
    f.value,
    f.evidence,
    f.reason,
    f.status,
    f.quotes || [],
    f.alternatives || [],
    f.packReview || null,
    (dependencies[column] || []).map((k) => basis(r.values[k])),
  );
function invalidate(before, after) {
  const topology =
    before.sheet !== after.sheet ||
    !same(before.anchors, after.anchors) ||
    before.section !== after.section;
  const boundaryChanged = before.boundary !== after.boundary;
  for (const [column, f] of Object.entries(after.values))
    if (
      topology ||
      boundaryChanged ||
      (dependencies[column] || []).some(
        (parent) => basis(before.values[parent]) !== basis(after.values[parent]),
      )
    ) {
      if (
        ['accepted', 'edited', 'blank', 'auto_blank', 'auto_accepted', 'auto_evaluated'].includes(
          f.status,
        ) &&
        same(before.values[column], f)
      ) {
        f.status = 'pending';
        f.reason +=
          ' Source context, inclusion or a related field changed; review this decision again.';
      }
    }
  if (topology) after.boundary = 'pending';
  if (topology || boundaryChanged)
    for (const [k, f] of Object.entries(after.extras))
      if (same(before.extras[k], f)) {
        f.status = 'pending';
        f.reason += ' Item source context or inclusion changed; review again.';
      }
}
/** Human decisions and separately validated system rules; AI cannot assert either approval. Session-only. */
export function createReviewController() {
  const formulas = new Map(),
    extraAutomatic = new Map(),
    evaluated = new Map(),
    automatic = new Map(),
    fields = new Map(),
    boundaries = new Map(),
    columns = new Map(),
    coverage = new Map(),
    layouts = new Map(),
    itemRevisions = new Map();
  let revision = 0,
    requiresEvaluation = false,
    evaluationComplete = false;
  function stamp(action, reason) {
    return { id: 'review-' + ++revision, revision, action, reason, time: new Date().toISOString() };
  }
  return {
    formulas,
    fields,
    boundaries,
    columns,
    coverage,
    layouts,
    itemRevisions,
    automatic,
    evaluated,
    extraAutomatic,
    automate(records, book) {
      for (const r of records)
        for (const [column, f] of Object.entries(r.values)) {
          const id = key(r.id, column),
            precision = column === 'K' && precisionProblem(f.value);
          if (precision) {
            f.status = 'pending';
            f.reason = precision;
            automatic.delete(id);
            evaluated.delete(id);
            continue;
          }
          if (f.status === 'auto_evaluated') {
            const checked = evaluated.get(id);
            if (
              checked?.signature === signature(r, f, column) &&
              evaluationEligible(r, column, f, book)
            )
              continue;
            f.status = 'pending';
            evaluated.delete(id);
          }
          const rule = automaticRule(r, column, f, book);
          if (rule) {
            f.status = rule.status;
            f.reason = rule.reason;
            const sig = signature(r, f, column);
            if (automatic.get(id)?.signature !== sig || automatic.get(id)?.source !== rule.source)
              automatic.set(id, { ...rule, signature: sig, revision: ++revision });
          } else {
            automatic.delete(id);
            if (['auto_blank', 'auto_accepted'].includes(f.status)) f.status = 'pending';
          }
        }
      for (const r of records)
        for (const [name, f] of Object.entries(r.extras)) {
          const id = key(r.id, name);
          if (automaticExtraRule(r, f, book)) {
            f.status = 'auto_accepted';
            const sig = signature(r, f, null);
            if (extraAutomatic.get(id)?.signature !== sig)
              extraAutomatic.set(id, { signature: sig, revision: ++revision });
          } else {
            extraAutomatic.delete(id);
            if (f.status === 'auto_accepted') f.status = 'pending';
          }
        }
      return records;
    },
    evaluate(records, book, evaluations) {
      for (const verdict of evaluations.flatMap((e) => e.items)) {
        const r = records.find(
          (r) =>
            (r.id === verdict.recordId || !verdict.recordId) &&
            r.sheet === verdict.sheet &&
            same(r.anchors, verdict.anchors),
        );
        if (!r || verdict.boundary !== 'supported') continue;
        for (const finding of verdict.fields) {
          const f = r.values[finding.column];
          if (
            f.status !== 'pending' ||
            f.value !== finding.value ||
            finding.verdict !== 'supported' ||
            !evaluationEligible(r, finding.column, f, book) ||
            verdict.missing.some((m) => m.column === finding.column)
          )
            continue;
          const source = book.sheets.find((s) => s.name === r.sheet);
          if (
            !finding.evidence.every(
              (e) => e.sheet === r.sheet && source.cells[e.cell]?.raw.includes(e.quote),
            )
          )
            continue;
          f.status = 'auto_evaluated';
          evaluated.set(key(r.id, finding.column), {
            rule: 'evaluated-v2',
            reason: finding.reason,
            evidence: finding.evidence,
            signature: signature(r, f, finding.column),
            revision: ++revision,
          });
        }
      }
      evaluationComplete = true;
      return records;
    },
    ruleEvent(reason) {
      return {
        id: 'rule-' + ++revision,
        revision,
        reason,
        system: true,
        time: new Date().toISOString(),
      };
    },
    requireEvaluation() {
      requiresEvaluation = true;
      evaluationComplete = false;
    },
    get evaluationRequired() {
      return requiresEvaluation;
    },
    get evaluationComplete() {
      return evaluationComplete;
    },
    get revision() {
      return revision;
    },
    record(before, after, reason) {
      if (before.boundary !== after.boundary && ['include', 'exclude'].includes(after.boundary))
        after.evaluationBoundaryReview = false;
      invalidate(before, after);
      if (!same(before, after)) itemRevisions.set(after.id, (itemRevisions.get(after.id) || 0) + 1);
      if (before.boundary !== after.boundary && ['include', 'exclude'].includes(after.boundary))
        boundaries.set(after.id, {
          ...stamp(after.boundary, reason),
          signature: key(after.sheet, after.anchors, after.boundary),
        });
      for (const [kind, old, newFields] of [
        ['field', before.values, after.values],
        ['extra', before.extras, after.extras],
      ])
        for (const [k, f] of Object.entries(newFields)) {
          if (same(old[k], f)) continue;
          const id = key(kind, after.id, k);
          if (['accepted', 'edited', 'blank'].includes(f.status))
            fields.set(id, {
              ...stamp(
                f.status === 'blank'
                  ? 'accept_unknown'
                  : f.status === 'edited'
                    ? 'correct'
                    : 'accept',
                reason,
              ),
              signature: signature(after, f, kind === 'field' ? k : null),
            });
          else fields.delete(id);
        }
    },
    reconcile(beforeRecords, afterRecords) {
      for (const after of afterRecords) {
        const before = beforeRecords.find((r) => r.id === after.id);
        if (before && !same(before, after)) {
          invalidate(before, after);
          itemRevisions.set(after.id, (itemRevisions.get(after.id) || 0) + 1);
          for (const [kind, entries] of [
            ['field', after.values],
            ['extra', after.extras],
          ])
            for (const [k, f] of Object.entries(entries))
              if (f.status === 'pending') fields.delete(key(kind, after.id, k));
        }
      }
    },
    approveFormula(record, book, reason) {
      const proof = formulaReview(record, book);
      if (
        !proof?.ok ||
        record.values.K.status !== 'accepted' ||
        record.boundary !== 'include' ||
        fields.get(key('field', record.id, 'K'))?.signature !==
          signature(record, record.values.K, 'K')
      )
        throw Error('Formula calculation and annual quantity must be verified before approval.');
      formulas.set(key(record.id, proof.address), {
        ...stamp('accept', reason),
        signature: signature(record, record.values.K, 'K'),
        source: formulaSource(record, book, proof),
        address: proof.address,
      });
    },
    formulaVerified(record, book, address) {
      const proof = formulaReview(record, book),
        entry = formulas.get(key(record.id, address));
      return !!(
        entry &&
        proof?.ok &&
        proof.address === address &&
        record.boundary === 'include' &&
        entry.signature === signature(record, record.values.K, 'K') &&
        entry.source === formulaSource(record, book, proof)
      );
    },
    coverageEvent(reason) {
      return stamp('accept', reason);
    },
    column(name, status, definition = {}) {
      columns.set(name, {
        ...stamp(
          status === 'approved' ? 'approve_column' : 'decline_column',
          status === 'approved'
            ? 'Reviewer approved this proposed column.'
            : 'Reviewer declined this column; its values are omitted from Excel.',
        ),
        status,
        definition: key(definition),
      });
    },
  };
}
function typed(column, f, r, book) {
  const v = f.value,
    source = f.evidence
      .map((a) => book.sheets.find((s) => s.name === r.sheet)?.cells[a]?.raw || '')
      .join(' ');
  if (['B', 'C', 'I', 'J'].includes(column))
    return {
      text: v,
      namespace: {
        B: 'online_bid_sequence',
        C: 'customer_reference',
        I: 'manufacturer_part',
        J: 'manufacturer_part',
      }[column],
      issuer: null,
      source_label:
        column === 'B'
          ? 'Reviewer-confirmed online bid sequence'
          : column === 'C'
            ? 'Reviewer-confirmed customer reference'
            : labeledIdentifier(r, column, f, book)
              ? book.sheets.find((s) => s.name === r.sheet).cells[
                  labeledIdentifier(r, column, f, book).header
                ].raw
              : 'Reviewer-confirmed manufacturer part',
      source_order: column === 'J' ? 1 : 0,
    };
  if (column === 'D')
    return {
      source_text: source || v,
      normalized_text: source === v ? null : v,
      taxonomy_id: null,
      taxonomy_version: null,
    };
  if (column === 'G')
    return { raw_text: source || v, normalized_text: source === v ? null : v, system: null };
  if (column === 'L') return unit(v);
  if (column === 'K') {
    // Do not manufacture an annual period from placement in template K.
    const rowHeader = book.sheets.find((s) => s.name === r.sheet),
      cols = new Set(f.evidence.map((a) => a.replace(/\d+$/, ''))),
      rows = f.evidence.map((a) => Number(a.replace(/\D/g, ''))),
      headers = Object.entries(rowHeader?.cells || {})
        .filter(
          ([a]) =>
            cols.has(a.replace(/\d+$/, '')) && Number(a.replace(/\D/g, '')) < Math.min(...rows),
        )
        .map(([, c]) => c.raw),
      period = [...headers, source].find((t) => /\bannual\b|\byearly\b|per\s+year/i.test(t));
    return {
      amount: { kind: 'scalar', value: numeric(v), minimum: null, maximum: null, alternatives: [] },
      time_basis: period ? 'annual' : 'unknown',
      period_text: period || null,
      uom: r.values.L.value ? unit(r.values.L.value) : null,
      qualifiers: period
        ? []
        : [
            'Source period needs explicit review; template placement does not establish annual usage.',
          ],
    };
  }
  if (column === 'M') {
    const count = Number(numeric(v));
    if (!Number.isInteger(count) || count < 1 || count > 50000)
      throw Error('Pack count must be an integer between 1 and 50,000.');
    const pack = packagingReview(r, book),
      labeled = labeledPackCount(r, book);
    if (/^(\d+)\s*(PR)?\/(BX|BG|DZ)$/i.test((source || '').trim()) && !pack)
      throw Error(
        'Packaging count or container does not match its source. Review the relationship or leave it blank.',
      );
    if (pack && (!f.packReview || !same(f.packReview, pack.meta)))
      throw Error(
        'Confirm the count, container and annual purchasing-unit relationship using packaging review.',
      );
    if (f.packReview && (!pack || !same(f.packReview, pack.meta)))
      throw Error('Packaging source changed; review the relationship again.');
    return {
      container_uom: unit(r.values.L.value),
      count,
      content_uom: pack?.content ? unit(pack.content) : null,
      count_basis: pack?.content === 'PR' ? 'pair' : pack || labeled ? 'source_defined' : 'unknown',
      raw_expression: pack?.raw || labeled?.raw || source || v,
    };
  }
  return v;
}
/** Project UI candidates to v1.1 without inventing layout, coverage, formula or field approvals. */
export function buildCanonical({
  book,
  records,
  columns,
  name,
  digest,
  templateDigest,
  controller,
  columnMeta = {},
}) {
  const run = {
      schema_version: '1.1.0',
      run_id: 'run-' + digest,
      revision: controller.revision,
      extraction_version: 'prototype-bridge-v1',
      policy_version: 'canonical-v1.1-stock-identity-v1',
      template: { file_id: 'magid-template', sha256: templateDigest },
      bid_metadata: { customer_name: null, ticket_number: null },
      source_files: [
        {
          file_id: 'proposal',
          original_name: name,
          sha256: digest,
          source_role: 'customer_input',
          sheets: book.sheets.map((s, i) => ({ sheet_id: 'sheet-' + i, name: s.name, ordinal: i })),
        },
      ],
      evidence: [],
      regions: [],
      items: [],
      issues: [],
      review_events: [],
      extensions: [],
    },
    sheetId = new Map(book.sheets.map((s, i) => [s.name, 'sheet-' + i])),
    evidenceId = (sheet, a) => key('evidence', sheet, a),
    trusted = {
      cells: new Map(),
      file_hashes: new Map([['proposal', digest]]),
      layout_approvals: new Set(),
      field_approvals: new Map(),
      review_event_ids: new Set(),
      disposition_approvals: new Map(),
      extension_value_approvals: new Map(),
      evaluated_approvals: new Map(),
      stock_identity_approvals: new Map(),
      formula_approvals: new Map(),
    };
  const index = coverageIndex(book, records, controller),
    verifiedFormulas = new Set(
      records
        .filter((r) => controller.formulaVerified(r, book, r.values.K.evidence[0]))
        .map((r) => key(r.sheet, r.values.K.evidence[0])),
    );
  const eventIds = new Set();
  function event(approval, affected, candidate = null, evidence = []) {
    const id = approval.id;
    if (!eventIds.has(id)) {
      eventIds.add(id);
      run.review_events.push({
        event_id: id,
        run_id: run.run_id,
        affected_ids: affected,
        expected_revision: approval.revision - 1,
        resulting_revision: approval.revision,
        actor_id: 'session-reviewer',
        timestamp: approval.time,
        action: approval.action,
        prior_candidate_id: null,
        new_candidate_id: candidate,
        reason: approval.reason,
        supporting_evidence_ids: evidence,
      });
      trusted.review_event_ids.add(id);
    }
    return id;
  }
  for (const s of book.sheets) {
    const sid = sheetId.get(s.name),
      rid = 'region-' + sid,
      coverage = [],
      layout = controller.layouts.get(s.name),
      layoutApproved = !!layout && layout.signature === layoutSignature(controller, index, s.name);
    for (const [a, c] of Object.entries(s.cells)) {
      const disposition = currentCoverage(controller, index, s.name, a),
        id = evidenceId(s.name, a);
      run.evidence.push({
        evidence_id: id,
        file_id: 'proposal',
        sheet_id: sid,
        range: a,
        raw_value: c.raw,
        stored_type: c.type,
        displayed_text: c.displayedText || null,
        number_format: c.numberFormat || null,
        formula: c.formula,
        cached_result: c.formula ? c.raw : null,
        formula_verified: verifiedFormulas.has(key(s.name, a)),
        merge_anchor: null,
        semantic_role: disposition?.role || 'customer_specification',
        span: null,
      });
      coverage.push({
        evidence_id: id,
        disposition: disposition?.disposition || 'unresolved',
        item_ids: disposition?.itemIds || [],
        reason: disposition?.reason || 'Cell coverage not reviewed.',
      });
      trusted.cells.set(key('proposal', sid, a), c.raw);
      if (run.evidence.at(-1).formula_verified)
        trusted.formula_approvals.set(key('proposal', sid, a), { raw: c.raw, formula: c.formula });
    }
    if (layoutApproved) {
      if (!layout.system) event(layout, [rid]);
      trusted.layout_approvals.add(layout.id);
    }
    run.regions.push({
      region_id: rid,
      file_id: 'proposal',
      sheet_id: sid,
      range: 'whole-sheet',
      header_evidence_ids: coverage
        .filter((c) => c.disposition === 'header')
        .map((c) => c.evidence_id),
      lane_order: 0,
      section_label: null,
      classification: 'other',
      resolution: layoutApproved
        ? layout.system
          ? 'approved_rule'
          : 'reviewer_accepted'
        : 'unresolved',
      approval_ref: layoutApproved ? layout.id : null,
      coverage,
    });
  }
  for (const [order, r] of records.entries()) {
    const sid = sheetId.get(r.sheet),
      boundary = controller.boundaries.get(r.id),
      boundaryApproved =
        boundary?.signature === key(r.sheet, r.anchors, r.boundary) &&
        (!boundary.system || boundaryRule(r, book)?.source === boundary.source),
      item = {
        item_id: r.id,
        lineage: {
          file_id: 'proposal',
          sheet_id: sid,
          region_id: 'region-' + sid,
          source_ranges: [...r.anchors],
          section: r.section || null,
          lane_order: 0,
          source_order: order,
          parent_item_ids: [],
        },
        inclusion: boundaryApproved
          ? r.boundary === 'include'
            ? 'included'
            : 'excluded'
          : 'candidate',
        exclusion_reason:
          r.boundary === 'exclude'
            ? boundary?.reason || 'Reviewer excluded source occurrence.'
            : null,
        fields: {},
        identifiers: [],
        quantity_observations: [],
        pack_observations: [],
        context_notes: [],
        issue_ids: [],
      };
    if (boundaryApproved && !boundary.system) event(boundary, [r.id]);
    for (const [col, field] of Object.entries(fieldMap)) {
      const f = r.values[col],
        evaluation = controller.evaluated.get(key(r.id, col)),
        evaluatedApproved =
          f.status === 'auto_evaluated' &&
          evaluation?.signature === signature(r, f, col) &&
          evaluationEligible(r, col, f, book) &&
          evaluation.evidence.every((e) =>
            book.sheets.find((s) => s.name === r.sheet)?.cells[e.cell]?.raw.includes(e.quote),
          ),
        automatic = controller.automatic?.get(key(r.id, col)),
        rule = automaticRule(r, col, f, book),
        autoApproved =
          !!rule &&
          automatic?.signature === signature(r, f, col) &&
          automatic.rule === rule.rule &&
          automatic.source === rule.source,
        approval = controller.fields.get(key('field', r.id, col)),
        approved = item.inclusion !== 'excluded' && approval?.signature === signature(r, f, col),
        eid = f.evidence.map((a) => evidenceId(r.sheet, a)),
        d = {
          presence: f.value
            ? 'present'
            : autoApproved && f.status === 'auto_blank'
              ? 'absent'
              : f.status === 'blank'
                ? 'explicitly_unknown'
                : 'unresolved',
          candidates: [],
          selected_candidate_id: null,
          resolution: 'unresolved',
          review_reason_codes: [],
          decision_revision: 0,
          review_event_id: null,
          disposition_reason: null,
          confidence_assessment: confidence(),
        };
      if (item.inclusion === 'excluded') {
        d.presence = 'unresolved';
        item.fields[field] = d;
        continue;
      }
      if (f.value) {
        try {
          const value = typed(col, f, r, book),
            id = key('candidate', r.id, col),
            method =
              f.status === 'edited' || !eid.length
                ? 'reviewer_assertion'
                : f.origin === 'ai'
                  ? 'semantic'
                  : typeof value === 'string' &&
                      f.evidence.some(
                        (a) =>
                          book.sheets.find((s) => s.name === r.sheet)?.cells[a]?.raw.trim() ===
                          value,
                      )
                    ? 'copied'
                    : 'parsed';
          d.candidates.push({
            candidate_id: id,
            value,
            evidence_ids: eid,
            input_candidate_ids: [],
            method,
            rule_version:
              method === 'reviewer_assertion'
                ? 'session-review-v1'
                : evaluatedApproved
                  ? 'evaluated-v2'
                  : method === 'semantic'
                    ? 'ai-candidate-v1'
                    : autoApproved
                      ? automatic.rule
                      : 'prototype-source-v1',
            explanation:
              f.reason + (evaluatedApproved ? ' Independent evaluation: ' + evaluation.reason : ''),
          });
          if (evaluatedApproved) {
            d.selected_candidate_id = id;
            d.resolution = 'auto_accepted';
            d.decision_revision = evaluation.revision;
            trusted.field_approvals.set(key(r.id, field, id), value);
            trusted.evaluated_approvals.set(key(r.id, field, id), value);
          } else if (autoApproved && f.status === 'auto_accepted') {
            d.selected_candidate_id = id;
            d.resolution = 'auto_accepted';
            d.decision_revision = automatic.revision;
            trusted.field_approvals.set(key(r.id, field, id), value);
          } else if (approved && f.status !== 'blank') {
            d.selected_candidate_id = id;
            d.resolution = 'reviewer_accepted';
            d.decision_revision = approval.revision;
            d.review_event_id = event(approval, [r.id, field], id, eid);
            trusted.field_approvals.set(key(r.id, field, id), value);
          }
          for (const [i, alternative] of (f.alternatives || []).entries())
            if (alternative.value)
              d.candidates.push({
                candidate_id: key('alternative', r.id, col, i),
                value: typed(col, alternative, r, book),
                evidence_ids: alternative.evidence.map((a) => evidenceId(r.sheet, a)),
                input_candidate_ids: [],
                method: 'semantic',
                rule_version: 'ai-candidate-v1',
                explanation: alternative.reason,
              });
        } catch (e) {
          const id = key('issue', r.id, col);
          item.issue_ids.push(id);
          run.issues.push({
            issue_id: id,
            code: 'CANONICAL_VALUE_INVALID',
            scope: 'field',
            affected_ids: [r.id, field],
            severity: 'error',
            competing_candidate_ids: [],
            explanation: e.message,
            resolution_status: 'open',
            resolving_event_id: null,
            resolution_rule: null,
          });
        }
      } else if (autoApproved && f.status === 'auto_blank') {
        d.resolution = 'auto_accepted';
        d.decision_revision = automatic.revision;
        d.disposition_reason = automatic.reason;
        trusted.disposition_approvals.set(key(r.id, field), 'absent');
      } else if (approved && f.status === 'blank') {
        d.resolution = 'accepted_unknown';
        d.decision_revision = approval.revision;
        d.disposition_reason = approval.reason;
        d.review_event_id = event(approval, [r.id, field], null, eid);
      }
      if (!approved && !autoApproved && !evaluatedApproved && f.status !== 'pending')
        item.context_notes.push(
          field +
            ': UI disposition has no matching controller approval; canonical decision remains unresolved.',
        );
      item.fields[field] = d;
    }
    if (stockCodeReady(r, columns, book))
      trusted.stock_identity_approvals.set(r.id, r.extras['Source Product ID'].value);
    run.items.push(item);
  }
  let position = 14;
  for (const [column, status] of Object.entries(columns)) {
    const approval = controller.columns.get(column),
      approved =
        approval?.status === status && approval.definition === key(columnMeta[column] || {}),
      id = key('column', column),
      values = records
        .filter(
          (r) =>
            r.extras[column] && run.items.find((i) => i.item_id === r.id)?.inclusion !== 'excluded',
        )
        .map((r) => {
          const f = r.extras[column],
            a = controller.fields.get(key('extra', r.id, column));
          if (
            (a?.signature === signature(r, f, null) &&
              ['accepted', 'edited', 'blank'].includes(f.status)) ||
            (controller.extraAutomatic.get(key(r.id, column))?.signature ===
              signature(r, f, null) &&
              automaticExtraRule(r, f, book))
          )
            trusted.extension_value_approvals.set(key(id, r.id), f.value || null);
          return {
            item_id: r.id,
            value: f.value || null,
            evidence_ids: f.evidence.map((a) => evidenceId(r.sheet, a)),
          };
        }),
      meta = columnMeta[column],
      why =
        records.find((r) => r.extras[column])?.extras[column]?.reason ||
        'Preserve extra source context.';
    run.extensions.push({
      column_id: id,
      name: column,
      meaning: meta?.meaning || column,
      benefit_reason: meta?.benefit || why,
      evidence_ids: [...new Set(values.flatMap((v) => v.evidence_ids))],
      values,
      status: approved ? (status === 'approved' ? 'approved' : 'declined') : 'proposed',
      review_event_id: approved ? event(approval, [id]) : null,
      output_position: approved && status === 'approved' ? position++ : null,
      decline_disposition: approved && status === 'declined' ? approval.reason : null,
    });
  }
  return { run, trusted, coverageErrors: checkCoverage(controller, index, columns) };
}
export function checkCanonical(
  snapshot,
  { reviewed = false, coverage = false, final = false } = {},
) {
  const errors = validate(snapshot.run, { trusted: snapshot.trusted, final });
  if (coverage)
    for (const message of snapshot.coverageErrors)
      errors.push({ code: 'COVERAGE_REVIEW_REQUIRED', path: '/regions', message });
  for (const i of snapshot.run.issues)
    if (i.severity === 'error' && i.resolution_status === 'open')
      errors.push({ code: i.code, path: i.affected_ids.join('/'), message: i.explanation });
  if (reviewed) {
    for (const i of snapshot.run.items) {
      if (i.inclusion === 'candidate')
        errors.push({
          code: 'ITEM_UNRESOLVED',
          path: i.item_id,
          message: 'Review the current item boundary.',
        });
      if (i.inclusion !== 'excluded')
        for (const [field, d] of Object.entries(i.fields))
          if (!['auto_accepted', 'reviewer_accepted', 'accepted_unknown'].includes(d.resolution))
            errors.push({
              code: 'REVIEW_UNVERIFIED',
              path: i.item_id + '/' + field,
              message: 'Review this exact field value and its dependencies again.',
            });
    }
    for (const x of snapshot.run.extensions) {
      if (x.status === 'proposed')
        errors.push({
          code: 'COLUMN_PENDING',
          path: x.name,
          message: 'Approve or decline this column.',
        });
      if (x.status === 'approved')
        for (const v of x.values)
          if (
            snapshot.run.items.find((i) => i.item_id === v.item_id)?.inclusion !== 'excluded' &&
            !snapshot.trusted.extension_value_approvals.has(key(x.column_id, v.item_id))
          )
            errors.push({
              code: 'COLUMN_VALUE_UNVERIFIED',
              path: x.name + '/' + v.item_id,
              message: 'Review each value for this approved column.',
            });
    }
  }
  return errors;
}
