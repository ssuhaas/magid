import { buildCanonical, checkCanonical } from './bridge.mjs';
import { checkReady, readWorkbook, exportWorkbook } from '../workbook.mjs';
import { notify } from '../debug/trace.mjs';

/** Shared preflight and download gate. Approvals come only from the session controller. */
export function finalReadiness(args) {
  const snapshot = buildCanonical(args);
  const issues = checkCanonical(snapshot, { reviewed: true, coverage: true, final: true });
  const messages = checkReady(args.records, args.columns, args.coverageConfirmed, args.book);
  if (args.controller.evaluationRequired && !args.controller.evaluationComplete)
    messages.push(
      'AI extraction and separate source evaluation must finish. Retry AI processing; no partially evaluated results can be exported.',
    );
  for (const issue of issues) {
    const item = snapshot.run.items.find((i) => issue.path.includes(i.item_id));
    const sheetName = item
      ? snapshot.run.source_files
          .flatMap((f) => f.sheets)
          .find((s) => s.sheet_id === item.lineage.sheet_id)?.name
      : '';
    const location = item ? `${sheetName}: ${item.lineage.source_ranges.join(', ')} — ` : '';
    const explanations = {
      IDENTITY_NOT_PROJECTABLE:
        'Provide a supported template identity, or preserve one verified stock code in the approved Source Product ID column. Ambiguous code relationships still need review.',
      ANNUAL_BASIS:
        'Annual Usage needs an explicitly annual source quantity. Leave it blank when the period is unknown.',
      PACK_UOM_MISMATCH: 'Qty/UOM needs a reviewed container unit matching Customer UOM.',
      FORMULA_UNVERIFIED:
        'This value comes from an unverified formula. Leave it blank or use verified source evidence.',
      COLUMN_VALUE_UNVERIFIED: 'Review each included value for the approved additional column.',
      SOURCE_ROLE:
        'This selected fact uses supplier, alternate, historical or context evidence. Use original customer requirements or leave it blank.',
    };
    messages.push(location + (explanations[issue.code] || issue.message));
  }
  return { snapshot, issues, messages: [...new Set(messages)] };
}

async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** Reinspect immutable source bytes and validate the actual template before writing Excel. */
export async function exportReviewedWorkbook({
  proposalBytes,
  templateBytes,
  expectedSourceDigest,
  assertCurrent = () => {},
  observer,
  ...args
}) {
  const report = (stage, status, message, detail = {}) =>
    notify(observer, { stage, status, message, detail });
  report('readiness', 'running', 'Rechecking immutable source and template bytes.');
  assertCurrent();
  const [digest, templateDigest] = await Promise.all([
    sha256(proposalBytes),
    sha256(templateBytes),
  ]);
  assertCurrent();
  if (digest !== expectedSourceDigest)
    throw Error('Source changed during validation. Upload or review again.');
  const book = readWorkbook(proposalBytes);
  const readiness = finalReadiness({ ...args, book, digest, templateDigest });
  report(
    'readiness',
    readiness.messages.length ? 'blocked' : 'passed',
    'Canonical final-readiness checks completed.',
    { issues: readiness.issues, messages: readiness.messages },
  );
  if (readiness.messages.length)
    throw Error('Finish review before export: ' + readiness.messages.slice(0, 8).join(' '));
  assertCurrent();
  report('export', 'running', 'Writing template and verifying Excel values by readback.');
  const output = exportWorkbook(templateBytes, args.records, args.columns, observer);
  assertCurrent();
  return output;
}
