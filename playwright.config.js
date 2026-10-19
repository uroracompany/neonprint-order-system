import { defineConfig } from "@playwright/test";

const loopbackURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: loopbackURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: loopbackURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: "https://food-taster.invalid",
      VITE_SUPABASE_ANON_KEY: "food-taster-placeholder",
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
