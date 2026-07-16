import { handleAdminListUsers } from "../server/admin-list-users-handler.js";
import { handleAdminListOrders } from "../server/admin-list-orders-handler.js";
import { handleAdminCreateUser } from "../server/admin-create-user-handler.js";
import { handleAdminUpdateUser } from "../server/admin-update-user-handler.js";
import { handleAdminDeleteUser } from "../server/admin-delete-user-handler.js";
import { handleAdminDeleteOrderWithFiles } from "../server/storage-gateway.js";
import { handleAdminSetUserStatus } from "../server/admin-set-user-status-handler.js";
import { rateLimit } from "../server/rateLimit.js";

const ACTIONS = {
  "list-users": handleAdminListUsers,
  "list-orders": handleAdminListOrders,
  "create-user": handleAdminCreateUser,
  "update-user": handleAdminUpdateUser,
  "delete-user": handleAdminDeleteUser,
  "delete-order": handleAdminDeleteOrderWithFiles,
  "set-user-status": handleAdminSetUserStatus,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: `Demasiadas solicitudes. Intente de nuevo en ${retryAfter} segundos.` });
  }

  const { action, ...payload } = req.body || {};
  const handle = ACTIONS[action];
  if (!handle) {
    return res.status(400).json({ error: `Acción no válida: ${action}` });
  }

  const result = await handle(payload, {
    ...process.env,
    authHeader: req.headers.authorization || "",
  });
  return res.status(result.status).json(result.body);
}
