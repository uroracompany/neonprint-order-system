const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_REQUESTS = 30;

const hits = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) {
      hits.delete(key);
    }
  }
}, DEFAULT_WINDOW_MS);

// Do not keep a Node process alive solely for housekeeping in local/test runs.
cleanupTimer.unref?.();

export function rateLimit(req, { maxRequests = DEFAULT_MAX_REQUESTS, windowMs = DEFAULT_WINDOW_MS, scope = "default" } = {}) {
  const safeMaxRequests = Math.max(1, Number(maxRequests) || DEFAULT_MAX_REQUESTS);
  const safeWindowMs = Math.max(1000, Number(windowMs) || DEFAULT_WINDOW_MS);
  const ip =
    // Vercel injects this header. Do not trust generic client-controlled proxy headers.
    req.headers?.["x-vercel-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const action = req.body?.action || "unknown";
  const key = `${scope}:${ip}:${req.url || req.method}:${action}`;

  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + safeWindowMs });
    return { allowed: true, remaining: safeMaxRequests - 1 };
  }

  if (entry.count >= safeMaxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, remaining: safeMaxRequests - entry.count };
}
