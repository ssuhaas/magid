/** Browser review model. Controller proofs remain separate from these display statuses. */
export type Field = {
  value: string;
  evidence: string[];
  reason: string;
  status: string;
  direct?: boolean;
  origin?: string;
  alternatives?: Field[];
  packReview?: object;
};
export type Item = {
  id: string;
  sheet: string;
  anchors: string[];
  section: string;
  boundary: string;
  boundaryReason: string;
  ambiguous?: boolean;
  values: Record<string, Field>;
  extras: Record<string, Field>;
  sourceProductID?: Field;
  evaluationBoundaryReview?: boolean;
};
export type Book = {
  sheets: {
    name: string;
    hidden: string;
    hiddenRows: string[];
    cells: Record<
      string,
      { raw: string; type: string; formula: string | null; displayedText?: string }
    >;
  }[];
  population: number;
};

export type SourceSelection = {
  sheet: string;
  addresses: string[];
  contextOnly?: boolean;
  label?: string;
};
