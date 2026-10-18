import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
if (process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL must remain the Food Taster loopback URL.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "food-taster.spec.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: "https://food-taster.invalid",
      VITE_SUPABASE_ANON_KEY: "food-taster-placeholder",
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
