import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionPage = readFileSync(resolve("src/pages/page-production.jsx"), "utf8");

describe("Production delivery rework note contract", () => {
  it("loads notes only for the current recipient and selected order files", () => {
    expect(productionPage).toContain('.from("delivery_rework_event_items")');
    expect(productionPage).toContain('.eq("recipient_id", currentUserId)');
    expect(productionPage).toContain('.in("production_file_id", fileIds)');
    expect(productionPage).toContain('.order("created_at", { ascending: false })');
  });

  it("shows the newest directed correction only while that file is back in production", () => {
    expect(productionPage).toContain("if (!newestByFile[item.production_file_id])");
    expect(productionPage).toContain("file.status === PRODUCTION_FILE_STATUS.IN_PRODUCTION && deliveryReworkNotes[file.id]");
    expect(productionPage).toContain("Requiere corrección");
  });

  it("uses the restricted active-handoff read path for a persistent order badge", () => {
    expect(productionPage).toContain('rpc("get_active_delivery_rework_context"');
    expect(productionPage).toContain("Devuelta por entrega");
    expect(productionPage).toContain("lockedDeliveryId={reworkHandoff?.returning_delivery_id || \"\"}");
    expect(productionPage).toContain("reworkHandoffsReady");
  });
});
