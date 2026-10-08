/** Header meaning is source text, never a conclusion drawn from the code itself. */
export function identifierHeading(raw) {
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (/^(?:manufacturer|mfr\.?|mfg\.?)\s+(?:part|model)\s*(?:number|no\.?|#)$/i.test(text))
    return 'manufacturer';
  if (
    /^(?:(?:distributor|supplier|vendor|customer|source|product|item|stock)\s+)?(?:part|model|reference|stock|product|item)\s*(?:number|no\.?|#|code|id)$/i.test(text) ||
    /^(?:(?:distributor|supplier|vendor|customer|source|product|item)\s+)?SKU$/i.test(text)
  )
    return 'other';
  return null;
}
export function nearestIdentifierHeader(cells, address) {
  const column = address.replace(/\d+$/, '');
  const row = Number(address.replace(/\D/g, ''));
  return (
    Object.keys(cells)
      .filter((a) =>
        a.replace(/\d+$/, '') === column &&
        Number(a.replace(/\D/g, '')) < row &&
        identifierHeading(cells[a].raw),
      )
      .sort((a, b) => Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, '')))[0] || null
  );
}
