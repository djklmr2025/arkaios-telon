const MAX_TRACKED_CLIENTS = 10000;

/**
 * Fixed-window limiter kept in memory: enough for one small instance.
 * @param {number} limit requests allowed per window
 * @param {number} windowMs
 * @param {() => number} [clock]
 */
export function createRateLimiter(limit, windowMs, clock = Date.now) {
  const windows = new Map();

  function prune(time) {
    for (const [key, entry] of windows) {
      if (time - entry.start >= windowMs) windows.delete(key);
    }
  }

  return {
    allow(key) {
      const time = clock();
      if (windows.size >= MAX_TRACKED_CLIENTS) prune(time);
      const entry = windows.get(key);
      if (!entry || time - entry.start >= windowMs) {
        windows.set(key, { start: time, count: 1 });
        return true;
      }
      if (entry.count >= limit) return false;
      windows.set(key, { start: entry.start, count: entry.count + 1 });
      return true;
    },
  };
}
