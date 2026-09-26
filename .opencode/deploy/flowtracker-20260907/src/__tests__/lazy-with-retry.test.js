import { describe, expect, it, vi } from "vitest";
import { retryDynamicImport } from "../utils/lazyWithRetry";

describe("retryDynamicImport", () => {
  it("reintenta una importacion dinamica transitoria", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("error loading dynamically imported module"))
      .mockResolvedValueOnce({ default: "Dashboard" });

    await expect(retryDynamicImport(importer, { retries: 2, delayMs: 0 })).resolves.toEqual({
      default: "Dashboard",
    });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("propaga el ultimo error si el modulo nunca carga", async () => {
    const finalError = new TypeError("error loading dynamically imported module");
    const importer = vi.fn().mockRejectedValue(finalError);

    await expect(retryDynamicImport(importer, { retries: 1, delayMs: 0 })).rejects.toBe(finalError);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
