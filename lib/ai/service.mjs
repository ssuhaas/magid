import {
  requestSchema,
  validateProposal,
  partitionProposal,
  outputJSONSchema,
  TASK,
  DEFAULT_MODEL,
} from './contracts.mjs';
import {
  evaluationRequestSchema,
  evaluationJSONSchema,
  EVALUATION_TASK,
  validateEvaluation,
  partitionEvaluation,
} from './evaluation.mjs';
import { discoveryJSONSchema, DISCOVERY_TASK, validateDiscovery } from './item-discovery.mjs';
import { notify } from '../debug/trace.mjs';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export class ExtractionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
/** @param {unknown} input @param {{key?:string,provider?:string,model?:string,signal?:AbortSignal,fetchImpl?:typeof fetch,observer?:(event:any)=>void}} options */
async function callStructured(
  input,
  {
    key,
    provider = 'openai',
    model = provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_MODEL,
    signal,
    fetchImpl = fetch,
    observer,
    timeoutMs = 90000,
    maxTokens = 18000,
    attempts = 2,
    thinkingLevel,
  } = {},
  contract = {
    parse: (v) => requestSchema.parse(v),
    task: TASK,
    schema: outputJSONSchema,
    validate: validateProposal,
    stage: 'ai',
  },
) {
  const report = (status, message, detail = {}) =>
    notify(observer, { stage: contract.stage, status, message, detail });
  if (!key) throw new ExtractionError('Server-side model credential is not configured.', 503);
  if (!['openai', 'gemini'].includes(provider))
    throw new ExtractionError('Unsupported AI provider configuration.', 503);
  if (provider === 'gemini' && !/^gemini-[A-Za-z0-9.-]+$/.test(model))
    throw new ExtractionError('Invalid Gemini model configuration.', 503);
  const request = contract.parse(input);
  report('passed', 'AI request contract validated.', {
    provider,
    model,
    cells: request.cells?.length || request.source?.cells.length,
  });
  const body = {
    model,
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: maxTokens,
    instructions: contract.task,
    input: [{ role: 'user', content: JSON.stringify(request) }],
    text: {
      format: {
        type: 'json_schema',
        name: 'magid_bid_candidates',
        strict: true,
        schema: contract.schema,
      },
    },
  };
  const geminiBody = {
    systemInstruction: { parts: [{ text: contract.task }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(request) }] }],
    generationConfig: {
      ...(/^gemini-3[.-]/.test(model) && thinkingLevel
        ? { thinkingConfig: { thinkingLevel } }
        : {}),
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      responseJsonSchema: contract.schema,
    },
  };
  const url =
    provider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent'
      : 'https://api.openai.com/v1/responses';
  const headers =
    provider === 'gemini'
      ? { 'x-goog-api-key': key, 'Content-Type': 'application/json' }
      : { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const controller = new AbortController(),
    cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      report('running', 'Provider request started.', { attempt: attempt + 1 });
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(provider === 'gemini' ? geminiBody : body),
          signal: controller.signal,
        });
      } catch {
        throw new ExtractionError(
          controller.signal.aborted
            ? 'AI processing canceled or exceeded its request time limit. Retry to resume completed groups.'
            : 'AI provider connection failed. No changes were applied.',
          504,
        );
      }
      report(response.ok ? 'received' : 'failed', 'Provider returned an HTTP response.', {
        status: response.status,
        attempt: attempt + 1,
      });
      if (!response.ok) {
        if (provider === 'gemini' && response.status === 400) {
          const error = await response.json().catch(() => null);
          if (
            error?.error?.details?.some((d) => d.reason === 'API_KEY_INVALID') ||
            error?.error?.message === 'API key not valid. Please pass a valid API key.'
          )
            throw new ExtractionError(
              'The Gemini API key is invalid. Replace the server credential with a valid Google AI Studio key.',
              503,
            );
        }
        if (attempt + 1 < attempts && (response.status === 429 || response.status >= 500)) {
          report('retrying', 'Retrying a transient provider error.', { status: response.status });
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (response.status === 401 || response.status === 403)
          throw new ExtractionError(
            'The server credential is not authorized for this model. Check the API project and model access.',
            503,
          );
        if (response.status === 429)
          throw new ExtractionError(
            'API quota or rate limit reached. Check project billing or retry later.',
            429,
          );
        throw new ExtractionError(
          'The AI provider rejected the extraction request. No changes were applied.',
        );
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw new ExtractionError(
          controller.signal.aborted
            ? 'AI processing exceeded its request time limit. Retry to resume.'
            : 'The provider returned an incomplete response.',
          controller.signal.aborted ? 504 : 502,
        );
      }
      const usage = provider === 'gemini'
        ? {
            inputTokens: result.usageMetadata?.promptTokenCount,
            outputTokens: result.usageMetadata?.candidatesTokenCount,
            reasoningTokens: result.usageMetadata?.thoughtsTokenCount,
            totalTokens: result.usageMetadata?.totalTokenCount,
          }
        : {
            inputTokens: result.usage?.input_tokens,
            outputTokens: result.usage?.output_tokens,
            reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens,
            totalTokens: result.usage?.total_tokens,
          };
      report('running', 'Provider request completed.',
        Object.fromEntries(Object.entries(usage).filter(([, value]) => Number.isSafeInteger(value) && value >= 0)),
      );
      report('running', 'Checking response completion, JSON structure and source evidence.');
      if (provider === 'gemini') {
        if (
          result.promptFeedback?.blockReason ||
          result.candidates?.some((c) =>
            ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(c.finishReason),
          )
        )
          throw new ExtractionError('The model declined this extraction. Use manual review.');
        if (result.candidates?.length !== 1 || result.candidates[0].finishReason !== 'STOP')
          throw new ExtractionError(
            'AI response was incomplete. No partial result was applied.',
            413,
          );
        const parts = result.candidates[0].content?.parts || [];
        if (parts.some((p) => p.functionCall || p.inlineData))
          throw new ExtractionError('Unexpected AI output. No changes were applied.');
        try {
          const proposal = contract.validate(
            request,
            JSON.parse(
              parts
                .filter((p) => !p.thought && typeof p.text === 'string')
                .map((p) => p.text)
                .join(''),
            ),
          );
          report('validated', 'AI response passed contract and source-evidence validation.', {
            items: (proposal.proposal || proposal).items.length,
          });
          return {
            proposal: proposal.proposal || proposal,
            issues: proposal.issues || [],
            model,
            provider,
            digest: request.digest || request.source?.digest,
            scopeId: request.scopeId || request.source?.scopeId,
          };
        } catch {
          throw new ExtractionError(
            'AI output failed source-evidence or contract validation. No changes were applied.',
          );
        }
      }
      if (result.status !== 'completed')
        throw new ExtractionError(
          'AI response was incomplete. No partial result was applied.',
          413,
        );
      const content = (result.output || [])
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content || []);
      if (content.some((c) => c.type === 'refusal'))
        throw new ExtractionError('The model declined this extraction. Use manual review.');
      try {
        const proposal = contract.validate(
          request,
          JSON.parse(
            content
              .filter((c) => c.type === 'output_text')
              .map((c) => c.text)
              .join(''),
          ),
        );
        report('validated', 'AI response passed contract and source-evidence validation.', {
          items: (proposal.proposal || proposal).items.length,
        });
        return {
          proposal: proposal.proposal || proposal,
          issues: proposal.issues || [],
          model,
          digest: request.digest || request.source?.digest,
          scopeId: request.scopeId || request.source?.scopeId,
        };
      } catch {
        throw new ExtractionError(
          'AI output failed source-evidence or contract validation. No changes were applied.',
        );
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
export async function callExtraction(input, options = {}) {
  return callStructured(input, options);
}
export async function callEvaluation(input, options = {}) {
  const result = await callStructured(input, options, {
    parse: (v) => evaluationRequestSchema.parse(v),
    task: EVALUATION_TASK,
    schema: evaluationJSONSchema,
    validate: validateEvaluation,
    stage: 'evaluate',
  });
  return { evaluation: result.proposal, digest: result.digest, scopeId: result.scopeId };
}
export async function callExtractionAndEvaluation(input, options = {}) {
  const extracted = await callExtraction(input, options);
  const checked = await callEvaluation({ source: input, proposal: extracted.proposal }, options);
  return { ...extracted, evaluation: checked.evaluation };
}
export async function readLimitedJSON(request, limit) {
  if (Number(request.headers.get('content-length') || 0) > limit)
    throw new ExtractionError('Selected source region is too large. Use a smaller region.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ExtractionError('Request body is required.', 400);
  let length = 0;
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ExtractionError('Selected source region is too large. Use a smaller region.', 413);
    }
    parts.push(value);
  }
  const all = new Uint8Array(length);
  let p = 0;
  for (const v of parts) {
    all.set(v, p);
    p += v.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new ExtractionError('Invalid extraction request.', 400);
  }
}

const brief =
  ' Keep reasons short (one sentence), cite only necessary cells, and omit empty fields.';
export function callExtractionStage(input, options = {}) {
  return callStructured(
    input,
    { ...options, timeoutMs: 24000, maxTokens: 7000, attempts: 1, thinkingLevel: 'low' },
    {
      parse: (v) => requestSchema.parse(v),
      task: TASK + brief,
      schema: outputJSONSchema,
      validate: partitionProposal,
      stage: 'ai',
    },
  );
}
/** Completeness recovery uses the same provider transport, with explicit cell accounting. */
export function callDiscoveryStage(input, options = {}) {
  return callStructured(input,
    { ...options, timeoutMs: 90000, maxTokens: 18000, attempts: 1, thinkingLevel: 'low' },
    { parse: v => requestSchema.parse(v), task: DISCOVERY_TASK,
      schema: discoveryJSONSchema, validate: validateDiscovery, stage: 'ai' });
}
export async function callEvaluationStage(input, options = {}) {
  const result = await callStructured(
    input,
    { ...options, timeoutMs: 24000, maxTokens: 7000, attempts: 1, thinkingLevel: 'low' },
    {
      parse: (v) => evaluationRequestSchema.parse(v),
      task: EVALUATION_TASK + brief,
      schema: evaluationJSONSchema,
      validate: partitionEvaluation,
      stage: 'evaluate',
    },
  );
  return { evaluation: result.proposal, digest: result.digest, scopeId: result.scopeId };
}
