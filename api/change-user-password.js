import { handleChangeUserPassword } from "../server/change-user-password-handler.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const result = await handleChangeUserPassword(req.body, process.env);
  return res.status(result.status).json(result.body);
}