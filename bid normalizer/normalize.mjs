import { createHash, randomUUID } from 'node:crypto';
import { readWorkbook, extract, exportWorkbook, mapRows } from './src/workbook.mjs';
import { prepareDescriptions } from './src/description-policy.mjs';
import { createReviewController } from './src/canonical/bridge.mjs';
import { prepareNormalization } from './src/ai/normalize-proposal.mjs';
import { deterministicCompleteness } from './src/canonical/completeness.mjs';
import { planEnrichmentScopes } from './src/ai/scope-planner.mjs';
import { buildScope, applyProposal } from './src/ai/client.mjs';
import { rawItems } from './src/ai/item-discovery.mjs';
import { validateProposal } from './src/ai/contracts.mjs';
import { callExtractionStage, callDiscoveryStage } from './src/ai/service.mjs';
import { projectWorkbookRecords } from './projection.mjs';
import { planRecovery, preserveRawItems, preserveProductAnchors } from './item-coverage.mjs';

/** No browser, HTTP route, durable state, model evaluation or human decision dependency. */
export async function normalize(proposalBytes, templateBytes, config, {
  filename = 'proposal.xlsx', signal, onProgress, mapping,
} = {}) {
  if (!/\.xlsx$|\.xlsm$/i.test(filename)) throw Error('An .xlsx or .xlsm proposal is required.');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const check = () => { if (abort.signal.aborted) throw Error('Normalization canceled.'); };
  const report = event => { try { onProgress?.(event); } catch { /* Optional diagnostics. */ } };
  try {
    check();
    const book = readWorkbook(proposalBytes, filename);
    // Fail invalid templates before spending model requests.
    const { assertTemplateContract } = await import('./src/canonical/field-contracts.mjs');
    assertTemplateContract(readWorkbook(templateBytes));
    const digest = createHash('sha256').update(proposalBytes).digest('hex');
    const identified = mapping
      ? mapRows(book, mapping.sheet, mapping.start, mapping.end, mapping.columns)
      : extract(book).records;
    const baseline = prepareNormalization(book, prepareDescriptions(identified, book),
      createReviewController(), {}).filter(record => !record.ambiguous && !record.extras['Additional Source Code']?.value);
    const unresolved = baseline.filter(r => !deterministicCompleteness(r, book));
    const scopes = planEnrichmentScopes(book, unresolved, { digest, maxItems: config.maxItems });
    scopes.push(...planRecovery(book, baseline, digest));
    report({ stage: 'planned', items: baseline.length,
      skippedItems: baseline.length - unresolved.length, groups: scopes.length });
    const queue = [...scopes], results = new Map();
    let completed = 0, failure;
    const worker = async () => {
      try {
        while (queue.length) {
          check();
          const scope = queue.shift();
          let envelope;
          try {
            envelope = await (scope.mode === 'discover' ? callDiscoveryStage : callExtractionStage)(scope, { provider: config.provider,
              key: config.key, model: config.model, fetchImpl: config.fetchImpl,
              signal: abort.signal });
          } catch (error) {
            check();
            if ([413, 504].includes(error.status) && scope.records.length > 1) {
              const parts = scope.records.map(r => buildScope(book,
                baseline.filter(b => b.id === r.id), { digest, scopeId: randomUUID(), targeted: true }));
              scopes.splice(scopes.indexOf(scope), 1, ...parts);
              queue.push(...parts);
              continue;
            }
            if (scope.mode === 'discover') {
              const cells = scope.cells.filter(c => c.eligibleAnchor);
              throw Error(`Source coverage could not be resolved at ${cells[0]?.sheet}!${cells.slice(0, 8).map(c => c.cell).join(', ')}. ${error.message}`);
            }
            throw error;
          }
          check();
          if (envelope.digest !== digest || envelope.scopeId !== scope.scopeId)
            throw Error('Extraction belongs to a different proposal.');
          validateProposal(scope, envelope.proposal);
          if (scope.mode === 'discover') preserveProductAnchors(book, scope, envelope.proposal, identified);
          results.set(scope.scopeId, envelope);
          report({ stage: 'extract', completed: ++completed, groups: scopes.length });
        }
      } catch (error) {
        if (!failure) failure = error;
        abort.abort();
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, scopes.length) }, worker));
    if (failure) throw failure;
    check();
    let records = baseline;
    for (const scope of scopes) {
      const applied = applyProposal(scope.mode === 'discover' ? [] : records,
        book, scope, results.get(scope.scopeId));
      for (const record of applied.records)
        if (results.get(scope.scopeId).proposal.items.some(item => item.recordId === record.id && item.ambiguous))
          record.ambiguous = true;
      records = scope.mode === 'discover' ? [...records, ...applied.records] : applied.records;
    }
    if (!records.length) for (const scope of scopes.filter(s => s.mode === 'discover')) {
      const preserved = { ...results.get(scope.scopeId), proposal: {
        items: rawItems(scope.cells.filter(c => c.eligibleAnchor)), warnings: [] } };
      records.push(...applyProposal([], book, scope, preserved).records);
    }
    if (records.length > 2000) throw Error('Maximum 2,000 normalized items.');
    const occupied = new Set();
    for (const record of records) for (const anchor of record.anchors) {
      const key = JSON.stringify([record.sheet, anchor]);
      if (occupied.has(key)) throw Error('Overlapping source item boundaries.');
      occupied.add(key);
    }
    const projected = projectWorkbookRecords(records, book);
    preserveRawItems(records, projected, book);
    check();
    const output = exportWorkbook(templateBytes, projected.records, projected.columns);
    check();
    report({ stage: 'completed', items: projected.records.length });
    return output;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
