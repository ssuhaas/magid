// Remove the debug tab and these imports, or set this flag false to stop collection.
export const PIPELINE_DEBUG_ENABLED = true;
export const stages = [
  'upload',
  'parse',
  'identify',
  'normalize',
  'ai',
  'evaluate',
  'coverage',
  'review',
  'readiness',
  'export',
];
export function notify(observer, event) {
  try {
    observer?.(event);
  } catch {
    /* Diagnostics never change pipeline behavior. */
  }
}
export function createTrace(enabled = PIPELINE_DEBUG_ENABLED, limit = 400) {
  let events = [],
    dropped = 0,
    latest = {};
  return {
    add(event) {
      if (!enabled || !stages.includes(event.stage)) return;
      const {
        stage,
        status = 'info',
        message = '',
        detail = {},
        generation = 0,
        revision = 0,
      } = event;
      // Only explicit application diagnostics belong here; never pass headers or credentials.
      let safe;
      try {
        const raw = JSON.stringify(detail);
        safe =
          raw.length > 12000 ? { truncated: true, preview: raw.slice(0, 12000) } : JSON.parse(raw);
      } catch {
        safe = { unavailable: true };
      }
      const entry = {
        id: crypto.randomUUID(),
        time: Date.now(),
        stage,
        status,
        message: String(message).slice(0, 1500),
        detail: safe,
        generation,
        revision,
      };
      events.push(entry);
      // Keep only summary metadata outside the bounded history, not source details.
      latest[stage] = { status, time: entry.time, generation, revision };
      if (events.length > limit) {
        events.shift();
        dropped++;
      }
    },
    snapshot() {
      return { events: structuredClone(events), dropped, latest: structuredClone(latest) };
    },
    clear() {
      events = [];
      dropped = 0;
      latest = {};
    },
  };
}
