import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quotePage = readFileSync("src/pages/page-quote.jsx", "utf8");

describe("Caja customer creation boundaries", () => {
  it("does not expose or mount customer creation from the Caja page", () => {
    expect(quotePage).not.toContain("CreateClientModal");
    expect(quotePage).not.toContain("showNewClientModal");
    expect(quotePage).not.toContain("handleNewClientCreated");
    expect(quotePage).not.toMatch(/Nuevo\s+Cliente/i);
  });

  it("keeps registered-client lookup and linking available for existing customers", () => {
    expect(quotePage).toContain("RegisteredClientLinkModal");
    expect(quotePage).toContain("clients={clients}");
    expect(quotePage).toContain("onSearchClient={handleClientSearch}");
    expect(quotePage).toContain("openCreditClientRegistration");
  });
});
