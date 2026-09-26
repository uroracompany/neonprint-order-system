import { rateLimit } from "../server/rateLimit.js";
import { handlePublicTracking } from "../server/public-tracking-handler.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const { allowed, retryAfter } = rateLimit(req, { maxRequests: 12, windowMs: 60_000, scope: "public-tracking" });
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Intenta nuevamente en unos minutos." });
  }
  const result = await handlePublicTracking(req.body || {}, process.env);
  return res.status(result.status).json(result.body);
}
