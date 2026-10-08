import { PIPELINE_DEBUG_ENABLED, createTrace } from '@/lib/debug/trace.mjs';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { DEFAULT_MODEL, MAX_REQUEST_BYTES, requestSchema } from '@/lib/ai/contracts.mjs';
import {
  callExtractionStage,
  callEvaluationStage,
  ExtractionError,
  readLimitedJSON,
  DEFAULT_GEMINI_MODEL,
} from '@/lib/ai/service.mjs';
import { scopeMaxItems } from '@/lib/ai/scope-planner.mjs';
import { createRequestSlots, PROPOSAL_CONCURRENCY } from '@/lib/ai/request-slots.mjs';
export const dynamic = 'force-dynamic';
const slots = createRequestSlots();
const origin = 'https://magid-bid-normalizer.vieaura-4783.chatgpt.site';
function config() {
  const values = env as unknown as Record<string, string | undefined>;
  const provider = values.AI_PROVIDER || 'openai';
  return {
    provider,
    maxItems: scopeMaxItems(Number(values.AI_SCOPE_MAX_ITEMS)),
    key: provider === 'gemini' ? values.GEMINI_API_KEY : values.OPENAI_API_KEY,
    model:
      provider === 'gemini'
        ? values.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
        : values.OPENAI_MODEL || DEFAULT_MODEL,
  };
}
function json(value: unknown, status = 200, retryAfter?: number) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}
export async function GET() {
  if (!(await getChatGPTUser())) return json({ error: 'Sign in to use AI extraction.' }, 401);
  const c = config();
  return json({
    configured: !!c.key,
    provider: c.provider,
    model: c.model,
    concurrency: PROPOSAL_CONCURRENCY,
    maxItems: c.maxItems,
    storage: 'temporary request memory',
    providerNotice:
      c.provider === 'gemini'
        ? 'Selected source cell values are sent to Google Gemini. Unpaid usage may be used for product improvement and reviewed by humans; paid-project policies differ.'
        : 'Selected source cell values are sent to OpenAI. Response storage is disabled; provider abuse-monitoring retention may still apply.',
  });
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to use AI extraction.' }, 401);
  if (request.headers.get('origin') !== origin)
    return json({ error: 'This request must come from the private prototype.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'Expected JSON cell evidence.' }, 415);
  const c = config();
  if (!c.key) return json({ error: 'Server-side model credential is not configured.' }, 503);
  const admission = slots.acquire(user.userId);
  if (!admission.lease)
    return json(
      {
        error:
          admission.code === 'REQUEST_RATE_LIMIT'
            ? 'Waiting for the temporary request limit to reset.'
            : 'Waiting for a free AI processing slot. Processing will resume automatically.',
        code: admission.code,
      },
      429,
      admission.retryAfter,
    );
  const lease = admission.lease;
  const deadline = setTimeout(() => lease.abort.abort(), 27000);
  const cancel = () => lease.abort.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) cancel();
  const trace = createTrace(
    PIPELINE_DEBUG_ENABLED && request.headers.get('X-Pipeline-Debug') === '1',
    30,
  );
  const diagnostics = () =>
    request.headers.get('X-Pipeline-Debug') === '1' && PIPELINE_DEBUG_ENABLED
      ? { debug: trace.snapshot().events }
      : {};
  try {
    const raw = await readLimitedJSON(request, MAX_REQUEST_BYTES);
    const stage = request.headers.get('X-AI-Stage') || 'extract';
    if (!['extract', 'evaluate'].includes(stage))
      return json({ error: 'Invalid processing stage.' }, 400);
    if (stage === 'extract' && !requestSchema.safeParse(raw).success)
      return json({ error: 'Invalid or oversized source evidence request.' }, 400);
    const result = await (stage === 'evaluate' ? callEvaluationStage : callExtractionStage)(raw, {
      ...c,
      signal: lease.abort.signal,
      observer: (event: any) => trace.add(event),
    });
    return json({ ...result, ...diagnostics() });
  } catch (e) {
    if (e instanceof ExtractionError) return json({ error: e.message, ...diagnostics() }, e.status);
    return json(
      { error: 'Extraction failed safely. No changes were applied.', ...diagnostics() },
      502,
    );
  } finally {
    clearTimeout(deadline);
    slots.release(lease);
    request.signal.removeEventListener('abort', cancel);
  }
}
