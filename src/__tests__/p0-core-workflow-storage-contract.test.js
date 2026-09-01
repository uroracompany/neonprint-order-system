/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("P0 workflow and R2 catalog contracts", () => {
  it("installs a database guard and command-only workflow transitions", () => {
    const migration = read("supabase/migrations/20260826123000_p0_core_workflow_storage_hardening.sql");

    expect(migration).toContain("create trigger trg_guard_orders_direct_update");
    expect(migration).toContain("ORDER_PROTECTED_UPDATE");
    expect(migration).toContain("old.status is distinct from 'in_Quote'");
    expect(migration).toContain("seller_update_order");
    expect(migration).toContain("delivery_mark_order_delivered");
    expect(migration).toContain("idx_order_files_r2_active_lookup");
    expect(migration).toContain("seller_send_order_to_quote");
    expect(read("server/seller-order-actions-handler.js")).toContain("send_to_quote: handleSendToQuote");
  });

  it("requires an exact active catalog record for signed R2 reads", () => {
    const gateway = read("server/storage-gateway.js");

    // The resolver is provider-neutral now: R2 and Supabase references are
    // both parsed into one validated bucket/key pair before lookup.
    expect(gateway).toContain('.eq("bucket", ref.bucket)');
    expect(gateway).toContain('const provider = r2Ref ? "r2" : "supabase";');
    expect(gateway).toContain('.eq("status", "uploaded")');
    expect(gateway).toContain('.is("deleted_at", null)');
    expect(gateway).not.toContain("fileRecord?.order_id || getOrderIdFromPath(r2Ref.key)");
    expect(read("api/files.js")).not.toContain("bind-preorder-upload");
  });

  it("requires an active profile and a durable pre-order reservation before a signed upload", () => {
    const gateway = read("server/storage-gateway.js");
    const migration = read("supabase/migrations/20260829033401_production_readiness_asset_security.sql");

    expect(gateway).toContain('"id,name,email,role,employment_status,deleted_at"');
    expect(gateway).toContain("profile.employment_status === false || profile.deleted_at");
    expect(gateway).toContain("const reservePreorderAsset = async");
    expect(gateway).toContain("idempotencyKey === orderId");
    expect(migration).toContain("create table if not exists public.order_asset_preupload_reservations");
    expect(migration).toContain("La reserva del archivo previo no es válida o expiró");
  });

  it("keeps public tracking free of customer identity and production internals", () => {
    const migration = read("supabase/migrations/20260829033401_production_readiness_asset_security.sql");
    const trackingSql = migration.slice(
      migration.indexOf("create or replace function public.get_public_order_tracking"),
      migration.indexOf("revoke all on function public.get_public_order_tracking"),
    );
    const trackingPage = read("src/pages/page-tracking.jsx");

    expect(trackingSql).not.toContain("'client_name'");
    expect(trackingSql).not.toContain("'production_files'");
    expect(trackingSql).not.toContain("'production_area_code'");
    expect(trackingPage).toContain("}, [token]);");
    expect(trackingPage).not.toContain("order.client_name");
  });
});
