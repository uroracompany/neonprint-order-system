const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;

const hits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) {
      hits.delete(key);
    }
  }
}, WINDOW_MS);

export function rateLimit(req) {
  const ip =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  const action = req.body?.action || "unknown";
  const key = `${ip}:${req.url || req.method}:${action}`;

  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count };
}
