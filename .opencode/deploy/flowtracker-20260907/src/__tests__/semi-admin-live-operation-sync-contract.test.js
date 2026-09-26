import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (file) => readFileSync(resolve(file), "utf8");

describe("Semi-Admin live operational synchronization", () => {
  it("applies the confirmed command result before background reconciliation", () => {
    const page = readProjectFile("src/pages/pages-seller.jsx");
    const immediateStateUpdate = "setSelectedOrder((current) => mergeConfirmedOrder(current, result?.order));";
    const detailRefresh = "const detail = await runSellerOrderAction(\"detail\", { order_id: operationOrderId });";

    expect(page).toContain(immediateStateUpdate);
    expect(page).toContain("void (async () => {");
    expect(page.indexOf(immediateStateUpdate)).toBeLessThan(page.indexOf(detailRefresh));
  });
});
