import { describe, expect, it } from "vitest";
import {
  isAllowedLocalSmokeRequest,
  isAllowedLocalSmokeUrl,
  isAllowedPreviewRequest,
  isAllowedPreviewUrl,
  matchesPreviewHostname,
} from "../food-taster-preview-origin.mjs";

const prefix = "neonprint-order-system-";
const suffix = "-urora-companys-projects.vercel.app";
const preview = "https://neonprint-order-system-pr-42-urora-companys-projects.vercel.app";

describe("Food Taster anonymous Preview request policy", () => {
  it("accepts only HTTPS root URL on the reviewed project-specific hostname", () => {
    expect(isAllowedPreviewUrl(preview, prefix, suffix)).toBe(true);
    expect(matchesPreviewHostname("neonprint-order-system-pr-42-urora-companys-projects.vercel.app", prefix, suffix)).toBe(true);
    for (const unsafe of [
      "http://neonprint-order-system-pr-42-urora-companys-projects.vercel.app",
      "https://other-pr-42-urora-companys-projects.vercel.app",
      "https://neonprint-order-system-pr-42-other.vercel.app",
      `${preview}:443`, `${preview}/path`, `${preview}/?next=x`, `${preview}/#fragment`,
      preview.replace("https://", "https://user:pass@"), `${preview}.attacker.example`,
    ]) expect(isAllowedPreviewUrl(unsafe, prefix, suffix)).toBe(false);
  });

  it("allows only anonymous GET root navigation and same-origin static resources", () => {
    expect(isAllowedPreviewRequest(`${preview}/`, "GET", preview, prefix, suffix)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/assets/index-a1b2.js?v=1`, "GET", preview, prefix, suffix)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/assets/style.css`, "HEAD", preview, prefix, suffix)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/favicon-32x32.png`, "GET", preview, prefix, suffix)).toBe(true);
    expect(isAllowedPreviewRequest(`${preview}/logo-neonprint.jpg`, "GET", preview, prefix, suffix)).toBe(true);
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
    ["GET", `${preview}.attacker.example/assets/x.js`],
    ["GET", `${preview}:443/assets/x.js`],
  ])("blocks %s %s", (method, requestUrl) => {
    expect(isAllowedPreviewRequest(requestUrl, method, preview, prefix, suffix)).toBe(false);
  });

  it("blocks redirects to any non-allowlisted origin and non-static path", () => {
    expect(isAllowedPreviewRequest("https://evil.example/collect", "GET", preview, prefix, suffix)).toBe(false);
    expect(isAllowedPreviewRequest(`${preview}/redirect`, "GET", preview, prefix, suffix)).toBe(false);
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
