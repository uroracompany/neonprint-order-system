import { handleProductionProfile } from "../server/production-profile-handler.js";
import { rateLimit } from "../server/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo no permitido." });
  }

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  try {
    const result = await handleProductionProfile(req.body || {}, {
      ...process.env,
      authHeader: req.headers.authorization || "",
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[production-profile] Unhandled error:", err?.message || err);
    return res.status(500).json({ error: "Error interno del servidor al cargar el perfil." });
  }
}
