// Compile-only checks, included by tsc. Never execute these declarations.
import type {
  SourceScope, SourceEvidence, Proposal, Evaluation, StageCacheEntry,
  ExtractionResult, EvaluationResult, ProposalProcessingResult,
  ProposalProcessingOptions, EvaluatedProposal,
} from '../lib/ai/types';
import { processProposalScopes } from '../lib/ai/process-proposal.mjs';

declare const scope: SourceScope;
declare const proposal: Proposal;
declare const evaluation: Evaluation;
declare const extracted: ExtractionResult;
declare const evaluated: EvaluationResult;
declare const options: ProposalProcessingOptions;

const retryState: StageCacheEntry = { scope, extract: extracted, evaluate: evaluated };
const initialState: StageCacheEntry = { scope };
const output: Promise<ProposalProcessingResult> = processProposalScopes(options);
void [retryState, initialState, output];

// @ts-expect-error Wire mode is constrained by the existing runtime request schema.
const invalidScope: SourceScope = { ...scope, mode: 'approve' };
// @ts-expect-error Only original template columns B:M can be proposed by the model.
const invalidColumn: Proposal['items'][number]['fields'][number]['column'] = 'Z';
// @ts-expect-error Evidence must include the source quote.
const incompleteEvidence: SourceEvidence = { sheet: 'Bid', cell: 'A1' };
// @ts-expect-error An extraction response cannot replace independent evaluation.
const invalidCache: StageCacheEntry = { scope, evaluate: extracted };
// @ts-expect-error Complete processing requires an evaluation, not just extraction.
const incompleteResult: EvaluatedProposal = extracted;
// @ts-expect-error The processing boundary rejects arbitrary cache values.
processProposalScopes({ ...options, cache: new Map<string, string>() });
// @ts-expect-error Evaluation items are different from proposal items.
const invalidProposal: Proposal = evaluation;
// @ts-expect-error Model candidates cannot assert reviewer approval.
const approvedProposal: Proposal = { ...proposal, approved: true };
void [invalidScope, invalidColumn, incompleteEvidence, invalidCache, incompleteResult, invalidProposal, approvedProposal];
