import { expect, test } from "@playwright/test";
import {
  isAllowedLocalSmokeRequest,
  isAllowedLocalSmokeUrl,
  isAllowedPreviewRequest,
  isAllowedPreviewUrl,
} from "../scripts/food-taster-preview-origin.mjs";

const prefix = "neonprint-order-system-";
const suffix = "-urora-companys-projects.vercel.app";

test("the anonymous login smoke stays inside the public Preview shell", async ({ page, context, baseURL }) => {
  const isLocalSmoke = isAllowedLocalSmokeUrl(baseURL);
  if (!baseURL || (!isLocalSmoke && !isAllowedPreviewUrl(baseURL, prefix, suffix))) {
    throw new Error("PLAYWRIGHT_BASE_URL must be the fixed local smoke server or a reviewed NeonPrint Preview.");
  }
  const preview = new URL(baseURL);
  const blockedRequests = [];

  await context.route("**/*", async (route) => {
    const request = route.request();
    const isAllowedRequest = isLocalSmoke
      ? isAllowedLocalSmokeRequest(request.url(), request.method(), baseURL)
      : isAllowedPreviewRequest(request.url(), request.method(), baseURL, prefix, suffix);
    if (!isAllowedRequest) {
      blockedRequests.push({ url: request.url(), method: request.method() });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    blockedRequests.push({ url: "websocket", method: "WS" });
    socket.close({ code: 1008, reason: "Food Taster blocks WebSocket access." });
  });

  const response = await page.goto("/");
  expect(response, "the Preview should serve the public application shell").not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  expect(new URL(page.url()).origin).toBe(preview.origin);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: /Acceder al sistema/ })).toBeVisible();

  const blockedFetch = await page.evaluate(async () => {
    try {
      await fetch("/api/food-taster-read-only-probe", { method: "POST", body: "probe" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blockedFetch, "API writes should be blocked in the browser before reaching the Preview").toBe(true);
  expect(blockedRequests.some((request) => request.method === "POST" && request.url.includes("/api/"))).toBe(true);
  await page.evaluate(() => new Promise((resolve) => {
    const socketURL = new URL("/food-taster-probe", location.origin);
    socketURL.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketURL);
    const timer = setTimeout(() => { socket.close(); resolve(); }, 1000);
    socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
  }));
  expect(blockedRequests.some((request) => request.method === "WS")).toBe(true);
});
