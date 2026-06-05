import { handleAdminUpdateUser } from "../server/admin-update-user-handler.js";
import { verifyAdmin } from "../server/auth-middleware.js";
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

  const result = await handleAdminUpdateUser(req.body, process.env);
  return res.status(result.status).json(result.body);
}
