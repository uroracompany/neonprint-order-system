import { defineConfig } from "@playwright/test";
import { validateDeploymentUrl } from "./scripts/post-deploy-health.mjs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!validateDeploymentUrl(baseURL)) {
  throw new Error("PLAYWRIGHT_BASE_URL must be a validated immutable NeonPrint Production deployment URL.");
}
if (!/^[0-9a-f]{40}$/i.test(process.env.POST_DEPLOY_EXPECTED_SHA ?? "")
  || !/^\d+$/.test(process.env.POST_DEPLOY_EXPECTED_DEPLOYMENT_ID ?? "")
  || !/^\d+$/.test(process.env.POST_DEPLOY_EXPECTED_STATUS_ID ?? "")) {
  throw new Error("Validated deployment SHA and numeric deployment/status IDs are required.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "post-deploy-health.spec.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 45_000,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
