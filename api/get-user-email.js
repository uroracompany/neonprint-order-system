import { handleGetUserEmail } from "../server/get-user-email-handler.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const result = await handleGetUserEmail(req.body, process.env);
  return res.status(result.status).json(result.body);
}