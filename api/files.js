import { handleInitiateFileUpload, handleImportRemoteFile, handleFileDownloadUrl, handleCompleteFileUpload } from "../server/storage-gateway.js";
import { rateLimit } from "../server/rateLimit.js";

const ACTIONS = {
  "initiate-upload": handleInitiateFileUpload,
  "import-url": handleImportRemoteFile,
  "download-url": handleFileDownloadUrl,
  "complete-upload": handleCompleteFileUpload,
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
