import type { z } from 'zod';
import type { requestSchema, responseSchema } from './contracts.mjs';
import type { evaluationSchema, evaluationRequestSchema } from './evaluation.mjs';
import type { Book, Item } from '../review-types';

// Derive wire payloads from the runtime validators, rather than maintaining copies.
// These types describe data shape; they never grant controller approval.
export type SourceScope = z.infer<typeof requestSchema>;
export type Proposal = z.infer<typeof responseSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type EvaluationInput = z.infer<typeof evaluationRequestSchema>;
export type ProposalColumn = Proposal['items'][number]['fields'][number]['column'];
export type SourceEvidence = Proposal['items'][number]['fields'][number]['evidence'][number];
export type AIStage = 'extract' | 'evaluate';

export type DiagnosticEvent = {
  stage: string;
  status: string;
  message: string;
  detail?: object;
};
export type Observer = (event: DiagnosticEvent) => void;
export type ExtractionIssue = {
  recordId: string;
  sheet: string;
  anchors: string[];
  column: ProposalColumn | null;
  reason: string;
};
type ScopeIdentity = { digest: string; scopeId: string };
export type ExtractionResult = ScopeIdentity & {
  proposal: Proposal;
  issues?: ExtractionIssue[];
  debug?: DiagnosticEvent[];
};
export type EvaluationResult = ScopeIdentity & {
  evaluation: Evaluation;
  debug?: DiagnosticEvent[];
};
export type EvaluatedProposal = ExtractionResult & { evaluation: Evaluation };
export type StageResult = ExtractionResult | EvaluationResult;
export type StageInput = SourceScope | EvaluationInput;

/** Mutable retry state, owned by one temporary session. Not an approval record. */
export type StageCacheEntry = {
  scope: SourceScope;
  extract?: ExtractionResult;
  evaluate?: EvaluationResult;
};
export type StageCache = Map<string, StageCacheEntry>;
export type RequestControls = { signal?: AbortSignal; observer?: Observer };
export type SendStage = (
  stage: AIStage,
  input: StageInput,
  controls: RequestControls,
) => Promise<StageResult>;
export type StageOptions = {
  cache: StageCache;
  check: () => void;
  signal?: AbortSignal;
  observer?: Observer;
  progress?: (stage: AIStage | 'waiting', message?: string) => void;
  send?: SendStage;
};
export type ProcessStages = (scope: SourceScope, options: StageOptions) => Promise<EvaluatedProposal>;
/** Existing service error metadata; unknown thrown values are still possible. */
export type ProcessingError = Error & { status?: number; code?: string; retryAfter?: number };
export type ColumnMetadata = Record<string, { meaning: string; benefit: string }>;

export type ProposalProcessingOptions = {
  book: Book;
  baseline: Item[];
  /** Splitting mutates this session-owned queue to preserve retry behavior. */
  scopes: SourceScope[];
  sourceDigest: string;
  cache: StageCache;
  /** Throws when source ownership or reviewer revision is stale. */
  check: () => void;
  signal: AbortSignal;
  observer: Observer;
  progress: (message: string) => void;
  createScopeId?: () => string;
  concurrency?: number;
  process?: ProcessStages;
};
/** Staged candidates only. The caller must recheck ownership before committing. */
export type ProposalProcessingResult = {
  proposed: Item[];
  metadata: ColumnMetadata;
  notices: string[];
  evaluations: Evaluation[];
  issues: ExtractionIssue[];
};
