import type { Book } from '../review-types';
import type { extract } from '../workbook.mjs';

export type DecisionState = {
  generation: number;
  reviewRevision: number;
  sourceDigest: string;
  controllerRevision: number;
};
export type ParserResource = {
  worker: Pick<Worker, 'terminate'>;
  timer: ReturnType<typeof setTimeout>;
  cancel: (error: Error) => void;
};
export type ParsedWorkbook = { workbook: Book; result: ReturnType<typeof extract> };
export type ParserProgress = { stage: string; status: string; message: string; detail?: object };
