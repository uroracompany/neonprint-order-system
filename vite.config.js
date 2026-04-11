import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleAdminCreateUser } from './server/admin-create-user-handler.js'
import { handleGetUserEmail } from './server/get-user-email-handler.js'
import { handleChangeUserPassword } from './server/change-user-password-handler.js'

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
            const result = await handler(body, env);

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
export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(), 
      tailwindcss(), 
      createApiHandler("/api/admin-create-user", handleAdminCreateUser),
      createApiHandler("/api/get-user-email", handleGetUserEmail),
      createApiHandler("/api/change-user-password", handleChangeUserPassword),
    ],
  };
})
