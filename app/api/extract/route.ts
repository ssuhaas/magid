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
export const dynamic = 'force-dynamic';
const active = new Map<string, { id: string; expires: number; abort: AbortController }>();
const recent = new Map<string, { at: number; count: number }>();
const origin = 'https://magid-bid-normalizer.vieaura-4783.chatgpt.site';
function config() {
  const values = env as unknown as Record<string, string | undefined>;
  const provider = values.AI_PROVIDER || 'openai';
  return {
    provider,
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
  const now = Date.now();
  for (const [id, lease] of active)
    if (lease.expires <= now) {
      lease.abort.abort();
      active.delete(id);
    }
  for (const [id, v] of recent) if (now - v.at > 60000) recent.delete(id);
  if (recent.size > 100)
    return json(
      { error: 'The processing service is busy. Waiting for a free slot.', code: 'SERVICE_BUSY' },
      429,
      5,
    );
  const rate = recent.get(user.userId) || { at: now, count: 0 };
  if (rate.count >= 100)
    return json(
      { error: 'Waiting for the temporary request limit to reset.', code: 'REQUEST_RATE_LIMIT' },
      429,
      Math.max(1, Math.ceil((60000 - (now - rate.at)) / 1000)),
    );
  if (active.has(user.userId) || active.size >= 2)
    return json(
      {
        error:
          'Waiting for another proposal’s AI request to finish. Processing will resume automatically.',
        code: 'SESSION_BUSY',
      },
      429,
      3,
    );
  rate.count++;
  recent.set(user.userId, rate);
  const lease = { id: crypto.randomUUID(), expires: now + 27000, abort: new AbortController() };
  active.set(user.userId, lease);
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
    if (active.get(user.userId)?.id === lease.id) active.delete(user.userId);
    request.signal.removeEventListener('abort', cancel);
  }
}
