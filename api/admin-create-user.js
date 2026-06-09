import { handleAdminCreateUser } from "../server/admin-create-user-handler.js";
import { rateLimit } from "../server/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  const result = await handleAdminCreateUser(req.body, {
    ...process.env,
    authHeader: req.headers.authorization || "",
  });
  return res.status(result.status).json(result.body);
}
