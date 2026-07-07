import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleAdminCreateUser } from './server/admin-create-user-handler.js'
import { handleAdminUpdateUser } from './server/admin-update-user-handler.js'
import { handleAdminListOrders } from './server/admin-list-orders-handler.js'
import { handleAdminListUsers } from './server/admin-list-users-handler.js'
import { handleAdminSetUserStatus } from './server/admin-set-user-status-handler.js'
import { handleAdminDeleteUser } from './server/admin-delete-user-handler.js'
import { handleGetUserEmail } from './server/get-user-email-handler.js'
import { handleChangeUserPassword } from './server/change-user-password-handler.js'
import {
  handleAdminDeleteOrderWithFiles,
  handleCompleteFileUpload,
  handleFileDownloadUrl,
  handleImportRemoteFile,
  handleInitiateFileUpload,
} from './server/storage-gateway.js'
function createApiHandler(path, handler) {
  return {
    name: `api-handler-${path}`,
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
      
      server.middlewares.use(path, async (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        let rawBody = "";
        req.on("data", (chunk) => {
          rawBody += chunk;
        });

        req.on("end", async () => {
          try {
            const body = rawBody ? JSON.parse(rawBody) : {};
            const authHeader = req.headers["authorization"] || "";
            const HANDLER_TIMEOUT_MS = 20000;

            const result = await Promise.race([
              handler(body, { ...env, authHeader }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("El servicio no respondió a tiempo.")), HANDLER_TIMEOUT_MS)
              ),
            ]);

            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.body));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: error?.message || "Error interno del servidor." }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => {
  if (process.env.NODE_ENV !== "production" && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    // Local Windows dev can fail Supabase Auth validation when Node cannot validate
    // the corporate/local TLS chain. Browser Auth still works, but server-side
    // Admin APIs need this local-only relaxation to reach Supabase.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      createApiHandler("/api/admin-list-orders", handleAdminListOrders),
      createApiHandler("/api/admin-list-users", handleAdminListUsers),
      createApiHandler("/api/admin-create-user", handleAdminCreateUser),
      createApiHandler("/api/admin-update-user", handleAdminUpdateUser),
      createApiHandler("/api/admin-set-user-status", handleAdminSetUserStatus),
      createApiHandler("/api/admin-delete-user", handleAdminDeleteUser),
      createApiHandler("/api/get-user-email", handleGetUserEmail),
      createApiHandler("/api/change-user-password", handleChangeUserPassword),
      createApiHandler("/api/files-initiate-upload", handleInitiateFileUpload),
      createApiHandler("/api/files-complete-upload", handleCompleteFileUpload),
      createApiHandler("/api/files-download-url", handleFileDownloadUrl),
      createApiHandler("/api/files-import-url", handleImportRemoteFile),
      createApiHandler("/api/admin-delete-order", handleAdminDeleteOrderWithFiles),
    ],
  };
})
