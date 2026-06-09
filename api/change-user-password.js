import { handleChangeUserPassword } from "../server/change-user-password-handler.js";
import { requireAdmin } from "../server/auth-middleware.js";
import { rateLimit } from "../server/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  const auth = await requireAdmin(req.headers.authorization || "", process.env);

  if (!auth.authorized) {
    return res.status(auth.status || 403).json({ error: auth.error });
  }

  const result = await handleChangeUserPassword(req.body, process.env);
  return res.status(result.status).json(result.body);
}
