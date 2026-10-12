import { describe, expect, it } from "vitest";
import { getProductionUserDisplayName } from "../utils/productionUserName";

describe("production banner user name", () => {
  it("prefers the authenticated production profile name", () => {
    expect(getProductionUserDisplayName(
      { email: "production@example.com", user_metadata: { full_name: "Metadata Name" } },
      { name: "Juan Pérez", role: "digital_producer" },
    )).toBe("Juan Pérez");
  });

  it("falls back to the authenticated email when profile name is unavailable", () => {
    expect(getProductionUserDisplayName(
      { email: "production@example.com", user_metadata: {} },
      null,
    )).toBe("production@example.com");
  });
});
