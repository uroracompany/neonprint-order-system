import { defineConfig } from "@playwright/test";

const loopbackURL = "http://127.0.0.1:4173";
const previewMode = process.env.FOOD_TASTER_PREVIEW_SMOKE === "true";
const previewURL = process.env.PLAYWRIGHT_BASE_URL;

export function validatePreviewBaseURL(value) {
  let preview;
  try { preview = new URL(value); } catch { throw new Error("Preview smoke requires a valid PLAYWRIGHT_BASE_URL."); }
  if (preview.protocol !== "https:" || preview.port !== ""
      || !preview.hostname.startsWith("neonprint-order-system-")
      || !preview.hostname.endsWith("-urora-companys-projects.vercel.app")
      || preview.username || preview.password || preview.search || preview.hash) {
    throw new Error("Preview smoke URL must be an HTTPS deployment on the standard port from the NeonPrint Vercel project.");
  }
  return preview;
}

if (!previewMode && previewURL && previewURL !== loopbackURL) {
  throw new Error("PLAYWRIGHT_BASE_URL must remain the Food Taster loopback URL outside Preview smoke.");
}

if (previewMode) {
  const preview = validatePreviewBaseURL(previewURL);
  let stagingURL;
  let productionURL;
  try {
    stagingURL = new URL(process.env.FOOD_TASTER_STAGING_SUPABASE_URL || "");
    productionURL = new URL(process.env.FOOD_TASTER_PRODUCTION_SUPABASE_URL || "");
  } catch {
    throw new Error("Preview smoke requires valid staging and production Supabase URLs.");
  }
  if (stagingURL.protocol !== "https:" || !stagingURL.hostname.endsWith(".supabase.co")
      || stagingURL.port !== "" || productionURL.protocol !== "https:"
      || productionURL.port !== "" || !productionURL.hostname.endsWith(".supabase.co")
      || stagingURL.origin === productionURL.origin) {
    throw new Error("Preview smoke requires distinct HTTPS staging and production Supabase URLs.");
  }
}

const baseURL = previewMode ? previewURL : loopbackURL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
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
  webServer: previewMode ? undefined : {
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
