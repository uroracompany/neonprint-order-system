import { expect, test } from "@playwright/test";

const smokeOrigin = "http://127.0.0.1:4173";

test("the built login screen renders while external requests remain blocked", async ({ page, baseURL }) => {
  if (baseURL !== smokeOrigin) throw new Error("Food Taster smoke must target only its local loopback server.");

  const externalRequests = [];
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== smokeOrigin || requestUrl.username || requestUrl.password) {
      externalRequests.push(requestUrl.origin);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  const response = await page.goto("/");

  expect(response, "the local build should serve the application shell").not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: /Acceder al sistema/ })).toBeVisible();

  const allowedBlockedOrigins = new Set(["https://fonts.googleapis.com"]);
  const unexpectedOrigins = [...new Set(externalRequests)].filter((origin) => !allowedBlockedOrigins.has(origin));
  expect(unexpectedOrigins).toEqual([]);
});
