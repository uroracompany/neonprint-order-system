import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seller: vi.fn(),
  designer: vi.fn(),
  quote: vi.fn(),
  production: vi.fn(),
  delivery: vi.fn(),
  admin: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("../../server/seller-profile-handler.js", () => ({ handleSellerProfile: mocks.seller }));
vi.mock("../../server/designer-profile-handler.js", () => ({ handleDesignerProfile: mocks.designer }));
vi.mock("../../server/quote-profile-handler.js", () => ({ handleQuoteProfile: mocks.quote }));
vi.mock("../../server/production-profile-handler.js", () => ({ handleProductionProfile: mocks.production }));
vi.mock("../../server/delivery-profile-handler.js", () => ({ handleDeliveryProfile: mocks.delivery }));
vi.mock("../../server/admin-profile-handler.js", () => ({ handleAdminProfile: mocks.admin }));
vi.mock("../../server/rateLimit.js", () => ({ rateLimit: mocks.rateLimit }));

import handler from "../../api/profile.js";

const makeResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
};

const makeRequest = ({ method = "POST", scope, body = { period: "month" }, authorization = "Bearer test-token" } = {}) => ({
  method,
  query: scope === undefined ? {} : { scope },
  body,
  headers: { authorization },
  url: "/api/profile",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 29 });
  for (const profileHandler of [mocks.seller, mocks.designer, mocks.quote, mocks.production, mocks.delivery, mocks.admin]) {
    profileHandler.mockResolvedValue({ status: 200, body: { ok: true } });
  }
});

describe("profile API dispatcher", () => {
  it.each([
    ["seller", "seller"],
    ["designer", "designer"],
    ["quote", "quote"],
    ["production", "production"],
    ["delivery", "delivery"],
    ["admin", "admin"],
  ])("delegates only the %s scope and preserves the handler response", async (scope, handlerName) => {
    const response = makeResponse();
    const request = makeRequest({ scope });

    await handler(request, response);

    expect(mocks[handlerName]).toHaveBeenCalledWith(
      { period: "month" },
      expect.objectContaining({ authHeader: "Bearer test-token" }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ ok: true });
    expect(mocks.rateLimit).toHaveBeenCalledWith(request, { scope: `profile-${scope}` });
  });

  it("rejects unsupported methods and scopes before rate limiting or dispatch", async () => {
    const methodResponse = makeResponse();
    await handler(makeRequest({ method: "GET", scope: "seller" }), methodResponse);
    expect(methodResponse.status).toHaveBeenCalledWith(405);
    expect(methodResponse.json).toHaveBeenCalledWith({ error: "Metodo no permitido." });

    const invalidResponse = makeResponse();
    await handler(makeRequest({ scope: ["seller", "admin"] }), invalidResponse);
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({ error: "Perfil no valido." });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.seller).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("preserves the rate-limit response without invoking a profile handler", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfter: 12 });
    const response = makeResponse();

    await handler(makeRequest({ scope: "seller" }), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ error: "Demasiadas solicitudes. Intente de nuevo en 12 segundos." });
    expect(mocks.seller).not.toHaveBeenCalled();
  });

  it("preserves handler authorization responses", async () => {
    mocks.admin.mockResolvedValue({ status: 403, body: { error: "No autorizado." } });
    const response = makeResponse();

    await handler(makeRequest({ scope: "admin" }), response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "No autorizado." });
  });

  it("retains the production boundary error response only for production", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.production.mockRejectedValue(new Error("gateway failure"));
    const productionResponse = makeResponse();

    await handler(makeRequest({ scope: "production" }), productionResponse);

    expect(errorSpy).toHaveBeenCalledWith("[production-profile] Unhandled error:", "gateway failure");
    expect(productionResponse.status).toHaveBeenCalledWith(500);
    expect(productionResponse.json).toHaveBeenCalledWith({ error: "Error interno del servidor al cargar el perfil." });

    mocks.seller.mockRejectedValue(new Error("seller failure"));
    await expect(handler(makeRequest({ scope: "seller" }), makeResponse())).rejects.toThrow("seller failure");
    errorSpy.mockRestore();
  });
});
