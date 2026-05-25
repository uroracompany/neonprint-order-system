import { handleAdminCreateUser } from "../server/admin-create-user-handler.js";
import { verifyAdmin, jsonResponse } from "../server/auth-middleware.js";
import { rateLimit } from "../server/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  const auth = await verifyAdmin(
    req.headers.authorization || "",
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  if (!auth.authorized) {
    return res.status(401).json({ error: auth.error });
  }

  const result = await handleAdminCreateUser(req.body, process.env);
  return res.status(result.status).json(result.body);
}
