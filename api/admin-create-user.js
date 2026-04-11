import { handleAdminCreateUser } from "../server/admin-create-user-handler.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const result = await handleAdminCreateUser(req.body, process.env);
  return res.status(result.status).json(result.body);
}
