import { readWorkbook, extract } from './workbook.mjs';
self.onmessage = (
  event: MessageEvent<{ bytes: Uint8Array; filename: string; debug?: boolean }>,
) => {
  const progress = (stage: string, status: string, message: string, detail: object = {}) => {
    if (event.data.debug) self.postMessage({ progress: { stage, status, message, detail } });
  };
  try {
    const workbook = readWorkbook(event.data.bytes, event.data.filename);
    progress('parse', 'passed', 'Workbook parsed.', {
      sheets: workbook.sheets.length,
      cells: workbook.population,
    });
    progress('identify', 'running', 'Detecting sample layouts and item occurrences.');
    const result = extract(workbook);
    progress('identify', 'passed', 'Candidate item identification finished.', {
      profile: result.profile,
      items: result.records.length,
      warnings: result.warnings,
    });
    progress(
      'normalize',
      'passed',
      'Deterministic field candidates prepared; review remains pending.',
      { items: result.records.length },
    );
    self.postMessage({ workbook, result });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : 'Workbook parse failed.' });
  }
};
