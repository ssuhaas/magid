export type Progress = { stage: 'planned' | 'extract' | 'completed'; items?: number;
  skippedItems?: number; groups?: number; completed?: number };
export type Configuration = {
  provider?: 'openai' | 'gemini'; key?: string; model?: string;
  templateBytes?: Uint8Array; maxItems?: number; fetchImpl?: typeof fetch;
};
export type RequestOptions = {
  filename?: string; signal?: AbortSignal; onProgress?: (event: Progress) => void;
  mapping?: { sheet: string; start: number; end: number; columns: Record<string, string> };
};
/** Returns normalized .xlsx bytes. Evaluation/review belongs to the caller's pipeline. */
export function createBidNormalizer(config?: Configuration):
  (proposalBytes: Uint8Array, options?: RequestOptions) => Promise<Uint8Array>;
