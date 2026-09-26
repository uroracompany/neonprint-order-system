import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveOrderAssetUrl, openOrderAssetUrl } = vi.hoisted(() => ({
  resolveOrderAssetUrl: vi.fn(),
  openOrderAssetUrl: vi.fn(),
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl,
  openOrderAssetUrl,
  requiresOrderAssetGateway: (url) => String(url).startsWith("supabase://") || String(url).startsWith("r2://") || String(url).includes("/storage/v1/object/"),
}));

vi.mock("../utils/uploadOrderAsset", () => ({
  getStoragePathFromPublicUrl: vi.fn(),
}));

import { clearSecureUrlCache, getSecureUrlRefreshDelay, resolveBatchSecureUrls } from "../hooks/useSecureFileUrl";

describe("secure file URL cache", () => {
  beforeEach(() => {
    clearSecureUrlCache();
    resolveOrderAssetUrl.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts a signed URL before the server TTL and resolves it again", async () => {
    const assetRef = "supabase://order-docs/orders/order-1/files/art.pdf";
    resolveOrderAssetUrl
      .mockResolvedValueOnce("https://signed.example.com/first")
      .mockResolvedValueOnce("https://signed.example.com/second");

    await expect(resolveBatchSecureUrls([assetRef])).resolves.toEqual(new Map([[assetRef, "https://signed.example.com/first"]]));
    vi.advanceTimersByTime(getSecureUrlRefreshDelay() + 1);
    await expect(resolveBatchSecureUrls([assetRef])).resolves.toEqual(new Map([[assetRef, "https://signed.example.com/second"]]));

    expect(resolveOrderAssetUrl).toHaveBeenCalledTimes(2);
  });

  it("does not send an external URL to the asset resolver", async () => {
    await expect(resolveBatchSecureUrls(["https://example.com/untrusted.pdf"])).resolves.toEqual(new Map([["https://example.com/untrusted.pdf", null]]));
    expect(resolveOrderAssetUrl).not.toHaveBeenCalled();
  });
});
