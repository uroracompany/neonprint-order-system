/* global process */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("Semi-Administración history-verified return contract", () => {
  const migration = read("supabase/migrations/20260922160910_semi_admin_history_verified_quote_return.sql");
  const pendingReturnMigration = read("supabase/migrations/20260922163411_semi_admin_pending_return_and_asset_catalog.sql");
  const conciseReasonMigration = read("supabase/migrations/20260922170000_semi_admin_return_reason_minimum.sql");
  const handler = read("server/seller-order-actions-handler.js");

  it("requires an audited payment correction and routing event", () => {
    expect(migration).toContain("semi_admin_return_quote_to_previous_stage");
    expect(migration).toContain("paid_to_pending_in_quote");
    expect(migration).toContain("semi_admin_send_to_quote");
    expect(migration).toContain("semi_admin_send_design_to_quote");
    expect(migration).toContain("ORDER_STALE");
  });

  it("also permits ordinary pending orders only with an audited route into Caja", () => {
    expect(pendingReturnMigration).toContain("This event is optional for ordinary pending orders");
    expect(pendingReturnMigration).toContain("created_at <= coalesce(v_payment_event.created_at, now())");
    expect(pendingReturnMigration).toContain("source_route_event_id");
  });

  it("keeps the material policy create-only for Semi-Administration", () => {
    expect(migration).toContain("current_profile_role() in ('admin', 'semi_admin')");
    expect(migration).toContain("using (public.current_profile_role() = 'admin')");
  });

  it("exposes a dynamic previous-stage action through the seller endpoint", () => {
    expect(handler).toContain("return_quote_to_previous_stage");
    expect(handler).toContain("Regresar a Ventas");
    expect(handler).toContain("Regresar a Diseño");
    expect(handler).toContain("manage_design_assets");
    expect(handler).toContain("ORDER_STATUS.PENDING, ORDER_STATUS.IN_DESIGN");
  });

  it("keeps Semi-Admin return reasons non-empty without imposing ten characters", () => {
    expect(conciseReasonMigration).toContain("semi_admin_return_design_to_sales");
    expect(conciseReasonMigration).toContain("semi_admin_return_quote_to_previous_stage");
    expect(conciseReasonMigration).toContain("char_length(trim(coalesce(p_reason, ''))) < 1");
    expect(conciseReasonMigration).not.toContain("char_length(trim(coalesce(p_reason, ''))) < 10");
  });
});
