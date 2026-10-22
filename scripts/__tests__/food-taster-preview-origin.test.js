import { describe, expect, it } from "vitest";
import {
  isAllowedLocalSmokeRequest,
  isAllowedLocalSmokeUrl,
  isAllowedPreviewRequest,
  isAllowedPreviewUrl,
  matchesPreviewHostname,
} from "../food-taster-preview-origin.mjs";

const preview = "https://neonprint-order-system-food-taster.vercel.app";
const stagingRef = "codex/food-taster-preview-runner";
const featureRef = "feature/payment-form-refresh";
const otherBranchRef = "fix/order-search";
const branchPreview = "https://neonprint-order-system-food-taster-git-codex-food-taster-preview-runner-urora-companys-projects.vercel.app";
const futureFeaturePreview = "https://neonprint-order-system-food-taster-git-feature-payment-form-refresh-urora-companys-projects.vercel.app";
const otherBranchPreview = "https://neonprint-order-system-food-taster-git-fix-order-search-urora-companys-projects.vercel.app";
const shortenedStagingPreview = "https://neonprint-order-system-food-git-ca8a4d-urora-companys-projects.vercel.app";

describe("Food Taster anonymous staging Preview request policy", () => {
  it("accepts the isolated project's exact alias and generated aliases for future branches", () => {
    expect(isAllowedPreviewUrl(preview, stagingRef)).toBe(true);
    expect(isAllowedPreviewUrl(branchPreview, stagingRef)).toBe(true);
    expect(isAllowedPreviewUrl(futureFeaturePreview, featureRef)).toBe(true);
    expect(isAllowedPreviewUrl(otherBranchPreview, otherBranchRef)).toBe(true);
    expect(isAllowedPreviewUrl(shortenedStagingPreview, "codex/food-taster-activation-check")).toBe(true);
    expect(matchesPreviewHostname(new URL(preview).hostname, stagingRef)).toBe(true);
    expect(isAllowedPreviewUrl(preview, featureRef)).toBe(false);
    expect(isAllowedPreviewUrl(futureFeaturePreview, otherBranchRef)).toBe(false);
    for (const unsafe of [
      "https://neonprint-order-system.vercel.app",
      "https://neonprint-order-system-git-codex-a1b2c3-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-food-taster-pr-42.vercel.app",
      "https://neonprint-order-system-food-taster-git-main-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-food-taster-git-unsafe-branch-a1b2c-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-food-taster.vercel.app.attacker.example",
      "http://neonprint-order-system-food-taster.vercel.app",
      `${preview}:443`, `${preview}/path`, `${preview}/?next=x`, `${preview}/#fragment`,
      preview.replace("https://", "https://user:pass@"),
      "https://neonprint-order-system-food-taster-git-codex-food-taster-preview-runner-a1b2c-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-food-git-ca8a4-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-food-git-ca8a4d-neonprint.vercel.app",
      "https://neonprint-order-system-food-git-ca8a4d-extra-urora-companys-projects.vercel.app",
    ]) expect(isAllowedPreviewUrl(unsafe, stagingRef)).toBe(false);
  });

  it("allows anonymous GET root navigation and same-origin static resources only", () => {
    expect(isAllowedPreviewRequest(`${preview}/`, "GET", preview, stagingRef)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/assets/index-a1b2.js?v=1`, "GET", preview, stagingRef)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/assets/style.css`, "HEAD", preview, stagingRef)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/favicon-32x32.png`, "GET", preview, stagingRef)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/logo-neonprint.jpg`, "GET", preview, stagingRef)).toBe(true);
  });

  it.each([
    ["POST", `${preview}/`],
    ["PUT", `${preview}/assets/app.js`],
    ["PATCH", `${preview}/assets/app.js`],
    ["DELETE", `${preview}/assets/app.js`],
    ["GET", `${preview}/api/orders`],
    ["GET", `${preview}/auth/v1/user`],
    ["GET", "https://attacker.example/collect"],
    ["GET", "https://abc.supabase.co/rest/v1/orders"],
    ["GET", `${preview}/service-worker.js`],
    ["GET", `${preview}/assets/%2e%2e/api/orders`],
    ["GET", `${preview}/assets/config.json`],
    ["WS", `${preview}/socket`],
    ["GET", "https://neonprint-order-system.vercel.app/assets/x.js"],
    ["GET", `${preview}:443/assets/x.js`],
  ])("blocks %s %s", (method, requestUrl) => {
    expect(isAllowedPreviewRequest(requestUrl, method, preview, stagingRef)).toBe(false);
  });

  it("blocks redirect targets outside the exact staging host and static paths", () => {
    expect(isAllowedPreviewRequest("https://evil.example/collect", "GET", preview, stagingRef)).toBe(false);
    expect(isAllowedPreviewRequest(`${preview}/redirect`, "GET", preview, stagingRef)).toBe(false);
  });
});

describe("Food Taster local build smoke request policy", () => {
  const local = "http://127.0.0.1:4173/";

  it("accepts only the fixed loopback root used by Playwright config", () => {
    expect(isAllowedLocalSmokeUrl(local)).toBe(true);
    for (const unsafe of [
      "http://localhost:4173/", "http://127.0.0.1:4174/", "https://127.0.0.1:4173/",
      "http://127.0.0.1:4173/api", "http://user:pass@127.0.0.1:4173/",
      "http://127.0.0.1:4173/?next=x", "http://127.0.0.1:4173/#fragment",
    ]) expect(isAllowedLocalSmokeUrl(unsafe)).toBe(false);
  });

  it("permits only root GET and same-origin static GET/HEAD requests", () => {
    expect(isAllowedLocalSmokeRequest(local, "GET", local)).toBe(true);
    expect(isAllowedLocalSmokeRequest("http://127.0.0.1:4173/assets/app-a1b2.js", "GET", local)).toBe(true);
    expect(isAllowedLocalSmokeRequest("http://127.0.0.1:4173/favicon.ico", "HEAD", local)).toBe(true);
    for (const [method, url] of [
      ["POST", local], ["PUT", "http://127.0.0.1:4173/assets/app.js"],
      ["GET", "http://127.0.0.1:4173/api/orders"], ["GET", "http://127.0.0.1:4174/assets/app.js"],
      ["GET", "https://attacker.example/assets/app.js"], ["WS", "ws://127.0.0.1:4173/socket"],
    ]) expect(isAllowedLocalSmokeRequest(url, method, local)).toBe(false);
  });
});
