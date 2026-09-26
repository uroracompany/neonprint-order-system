import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminApiFetch } = vi.hoisted(() => ({ adminApiFetch: vi.fn() }));

vi.mock("../utils/adminApi", () => ({ adminApiFetch }));

import {
  openOrderAssetUrl,
  requiresOrderAssetGateway,
  resolveOrderAssetUrl,
} from "../utils/fileAccess";

describe("file access", () => {
  beforeEach(() => {
    adminApiFetch.mockReset();
  });

  it("classifies only managed asset references for gateway resolution", () => {
    expect(requiresOrderAssetGateway("supabase://order-previews/orders/order-1/preview/image.webp")).toBe(true);
    expect(requiresOrderAssetGateway("r2://order-docs/orders/order-1/files/arte.pdf")).toBe(true);
    expect(requiresOrderAssetGateway("https://project.supabase.co/storage/v1/object/sign/order-docs/file.pdf")).toBe(true);
    expect(requiresOrderAssetGateway("https://example.com/file.pdf")).toBe(false);
  });

  it("asks the gateway for a download URL when downloading a managed asset", async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { url: "https://signed.example.com/file.pdf" } });

    await expect(resolveOrderAssetUrl("supabase://order-docs/orders/order-1/files/arte.pdf", { download: true })).resolves.toBe("https://signed.example.com/file.pdf");

    expect(adminApiFetch).toHaveBeenCalledWith("/api/files", expect.objectContaining({
      action: "resolve-download",
      assetRef: "supabase://order-docs/orders/order-1/files/arte.pdf",
      download: true,
    }));
  });

  it("reserves a browser destination before resolving a protected download", async () => {
    const destination = { opener: "parent", location: { assign: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(destination);
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: { url: "https://signed.example.com/file.pdf" } });

    await openOrderAssetUrl({
      url: "supabase://order-docs/orders/order-1/files/arte.pdf",
      fileName: "arte.pdf",
      download: true,
    });

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(destination.opener).toBeNull();
    expect(destination.location.assign).toHaveBeenCalledWith("https://signed.example.com/file.pdf");
    open.mockRestore();
  });

  it("closes the reserved destination if the protected resolver fails", async () => {
    const destination = { opener: "parent", location: { assign: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(destination);
    adminApiFetch.mockResolvedValue({ response: { ok: false }, result: { error: "No autorizado" } });

    await expect(openOrderAssetUrl({
      url: "r2://order-docs/orders/order-1/files/arte.pdf",
      fileName: "arte.pdf",
      download: true,
    })).rejects.toThrow("No autorizado");

    expect(destination.close).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
