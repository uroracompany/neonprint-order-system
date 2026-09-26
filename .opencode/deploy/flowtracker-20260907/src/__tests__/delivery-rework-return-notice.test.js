import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = [
  "20260830201247_delivery_rework_return_to_delivery_notice.sql",
  "20260830201839_fix_delivery_rework_return_notice_type_and_acknowledgement.sql",
].map((file) => readFileSync(resolve("supabase/migrations", file), "utf8")).join("\n");
const deliveryPage = readFileSync(resolve("src/pages/page-delivery.jsx"), "utf8");
const productionPage = readFileSync(resolve("src/pages/page-production.jsx"), "utf8");

describe("Delivery rework return notice", () => {
  it("notifies only the original Delivery user when Production closes the handoff", () => {
    expect(migration).toContain("notify_delivery_rework_returned_to_delivery");
    expect(migration).toContain("array[new.returning_delivery_id]");
    expect(migration).toContain("'order_returned'");
    expect(migration).toContain("Orden regresada de Producción");
    expect(migration).toContain("La orden regresó de Producción y está disponible nuevamente para revisión.");
    expect(migration).toContain("'delivery_rework_returned_to_delivery'");
  });

  it("keeps the Delivery badge separate from notification state and protects its read surface", () => {
    expect(migration).toContain("delivery_opened_at timestamptz");
    expect(migration).toContain("get_pending_delivery_rework_return_badges");
    expect(migration).toContain("h.returning_delivery_id = v_actor");
    expect(migration).toContain("o.delivery_id = v_actor");
    expect(migration).toContain("acknowledge_delivery_rework_return");
    expect(migration).toContain("for update of h");
    expect(migration).toContain("return true;");
    expect(migration).toContain("grant execute on function public.acknowledge_delivery_rework_return(uuid) to authenticated");
  });

  it("shows the badge until Delivery opens details and confirms the Production resend", () => {
    expect(deliveryPage).toContain('rpc("get_pending_delivery_rework_return_badges"');
    expect(deliveryPage).toContain('rpc("acknowledge_delivery_rework_return"');
    expect(deliveryPage).toContain("Regresada de Producción");
    expect(productionPage).toContain("La orden se envió correctamente a Delivery.");
  });
});
