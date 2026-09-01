import { handleSellerProfile } from "../server/seller-profile-handler.js";
import { handleDesignerProfile } from "../server/designer-profile-handler.js";
import { handleQuoteProfile } from "../server/quote-profile-handler.js";
import { handleProductionProfile } from "../server/production-profile-handler.js";
import { handleDeliveryProfile } from "../server/delivery-profile-handler.js";
import { handleAdminProfile } from "../server/admin-profile-handler.js";
import { rateLimit } from "../server/rateLimit.js";

const PROFILE_HANDLERS = Object.freeze({
  seller: handleSellerProfile,
  designer: handleDesignerProfile,
  quote: handleQuoteProfile,
  production: handleProductionProfile,
  delivery: handleDeliveryProfile,
  admin: handleAdminProfile,
});

const invalidProfile = (res) => res.status(400).json({ error: "Perfil no valido." });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo no permitido." });
  }

  const scope = req.query?.scope;
  if (typeof scope !== "string" || !Object.hasOwn(PROFILE_HANDLERS, scope)) {
    return invalidProfile(res);
  }

  const { allowed, retryAfter } = rateLimit(req, { scope: `profile-${scope}` });
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  const env = {
    ...process.env,
    authHeader: req.headers.authorization || "",
  };
  const profileHandler = PROFILE_HANDLERS[scope];

  if (scope === "production") {
    try {
      const result = await profileHandler(req.body || {}, env);
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error("[production-profile] Unhandled error:", err?.message || err);
      return res.status(500).json({ error: "Error interno del servidor al cargar el perfil." });
    }
  }

  const result = await profileHandler(req.body || {}, env);
  return res.status(result.status).json(result.body);
}
