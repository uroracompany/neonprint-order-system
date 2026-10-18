import { expect, test } from "@playwright/test";

const previewBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const stagingURL = new URL(process.env.FOOD_TASTER_STAGING_SUPABASE_URL || "");
const productionURL = new URL(process.env.FOOD_TASTER_PRODUCTION_SUPABASE_URL || "");
const anonKey = process.env.FOOD_TASTER_STAGING_SUPABASE_ANON_KEY;

test("Vercel Preview serves the login shell and only reaches staging Auth", async ({ page, request, baseURL }) => {
  const previewOrigin = new URL(baseURL).origin;
  expect(previewOrigin).toBe(new URL(previewBaseURL).origin);
  expect(stagingURL.origin).not.toBe(productionURL.origin);

  const unexpectedRequests = [];
  await page.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    const method = route.request().method();
    const isPreviewStaticGet = requestURL.origin === previewOrigin && method === "GET"
      && (requestURL.pathname === "/" || requestURL.pathname === "/index.html"
        || requestURL.pathname.startsWith("/assets/") || requestURL.pathname === "/favicon.ico"
        || requestURL.pathname === "/favicon.svg");
    const isStagingAuthSettings = requestURL.origin === stagingURL.origin && method === "GET"
      && requestURL.pathname === "/auth/v1/settings";
    if (isPreviewStaticGet || isStagingAuthSettings) {
      await route.continue();
      return;
    }
    unexpectedRequests.push(`${method} ${requestURL.origin}${requestURL.pathname}`);
    await route.abort("blockedbyclient");
  });

  const response = await page.goto(previewOrigin, { waitUntil: "domcontentloaded" });
  expect(response, "the exact Vercel Preview should serve the application shell").not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: /Acceder al sistema/ })).toBeVisible();

  const authResponse = await request.get(`${stagingURL.origin}/auth/v1/settings`, {
    headers: { apikey: anonKey },
    timeout: 15_000,
  });
  expect(authResponse.status(), "the separate staging Supabase Auth API should respond").toBe(200);
  expect(unexpectedRequests).toEqual([]);
});
