import { expect, test } from "@playwright/test";
import { isAllowedProductionReadRequest, isOptionalFontRequest, validateProductionSmokeUrl } from "../scripts/post-deploy-health.mjs";

test("anonymous Production login shell loads without accessing APIs or writing data", async ({ page, context, baseURL }) => {
  if (!validateProductionSmokeUrl(baseURL)) {
    throw new Error("PLAYWRIGHT_BASE_URL must be the exact public NeonPrint Production alias.");
  }

  const origin = new URL(baseURL).origin;
  const unexpectedRequests = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (isOptionalFontRequest(request.url(), request.method())) {
      await route.abort("blockedbyclient");
      return;
    }
    if (!isAllowedProductionReadRequest(request.url(), request.method(), origin)) {
      unexpectedRequests.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    unexpectedRequests.push("WebSocket connection");
    socket.close({ code: 1008, reason: "Production health smoke is read-only." });
  });

  const response = await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response, "deployment should return an HTTP response").not.toBeNull();
  expect(response.status()).toBeGreaterThanOrEqual(200);
  expect(response.status()).toBeLessThan(300);
  expect(new URL(page.url()).origin).toBe(origin);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: /Acceder al sistema/ })).toBeVisible();
  expect(unexpectedRequests, "browser attempted a request outside the allowlist").toEqual([]);
});
