const contains = (text, code) => {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^A-Za-z0-9])' + escaped + '($|[^A-Za-z0-9])').test(text);
};
/** Protect known source identifiers without assigning a manufacturer/customer namespace. */
export function identifierLoss(records, columns) {
  return records
    .filter((r) => r.boundary !== 'exclude' && columns['Source Product ID'] !== 'declined')
    .flatMap((r) => {
      const supplied = (r.extras['Source Product ID'] || r.sourceProductID)?.value;
      if (!supplied) return [];
      const codes = supplied
        .split(/\s*\|\s*/)
        .map((v) => v.trim())
        .filter(Boolean);
      const output = [
        ...Object.values(r.values).map((f) => f.value),
        ...Object.entries(r.extras)
          .filter(([k]) => columns[k] === 'approved')
          .map(([, f]) => f.value),
      ];
      const lost = codes.filter((code) => !output.some((text) => contains(text, code)));
      return lost.length ? [{ id: r.id, sheet: r.sheet, anchors: r.anchors, codes: lost }] : [];
    });
}
