/** In-memory admission control for one Worker isolate, not a durable job queue. */
export const PROPOSAL_CONCURRENCY = 2;
export function createRequestSlots({ total = 4, perUser = PROPOSAL_CONCURRENCY, rateLimit = 100 } = {}) {
  const active = new Map();
  const recent = new Map();
  return {
    acquire(userId, now = Date.now()) {
      for (const [id, lease] of active) {
        if (lease.expires <= now) {
          lease.abort.abort();
          active.delete(id);
        }
      }
      for (const [id, rate] of recent) if (now - rate.at >= 60000) recent.delete(id);
      if (!recent.has(userId) && recent.size >= 100)
        return { code: 'SERVICE_BUSY', retryAfter: 5 };
      const rate = recent.get(userId) || { at: now, count: 0 };
      if (rate.count >= rateLimit)
        return { code: 'REQUEST_RATE_LIMIT', retryAfter: Math.max(1, Math.ceil((60000 - (now - rate.at)) / 1000)) };
      if (active.size >= total || [...active.values()].filter(lease => lease.userId === userId).length >= perUser)
        return { code: 'SESSION_BUSY', retryAfter: 3 };
      const lease = { id: crypto.randomUUID(), userId, expires: now + 27000, abort: new AbortController() };
      active.set(lease.id, lease);
      recent.set(userId, { at: rate.at, count: rate.count + 1 });
      return { lease };
    },
    release(lease) {
      if (active.get(lease.id) === lease) active.delete(lease.id);
    },
  };
}
