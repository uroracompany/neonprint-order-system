import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve("supabase/migrations/20260830193657_delivery_rework_orderwide_context.sql"),
  "utf8"
);
const productionPage = readFileSync(resolve("src/pages/page-production.jsx"), "utf8");

describe("order-wide Delivery rework context", () => {
  it("exposes return context only through an authorised active-participant RPC", () => {
    expect(migration).toContain("get_active_delivery_rework_context(");
    expect(migration).toContain("current_user_assigned_to_production_area");
    expect(migration).toContain("revoke all on function public.get_active_delivery_rework_context(uuid[]) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_active_delivery_rework_context(uuid[]) to authenticated");
    expect(migration).toContain("'reason', item.correction_note");
    expect(migration).not.toContain("'recipient_id', item.recipient_id");
  });

  it("notifies selected recipients for action and other participants only for context", () => {
    expect(migration).toContain("'Archivo devuelto por Delivery'");
    expect(migration).toContain("'Orden devuelta por Delivery'");
    expect(migration).toContain("tus archivos no requieren corrección");
    expect(migration).toContain("where participant_id <> all(v_recipient_ids)");
    expect(migration).toContain("'delivery_rework_return_confirmed'");
  });

  it("shows the durable badge and return context in Production while keeping own-file correction separate", () => {
    expect(productionPage).toContain('rpc("get_active_delivery_rework_context"');
    expect(productionPage).toContain("Devuelta por entrega");
    expect(productionPage).toContain("Contexto de devolución");
    expect(productionPage).toContain("Requiere corrección");
    expect(productionPage).toContain('lockedDeliveryId={reworkHandoff?.returning_delivery_id || ""}');
  });
});
