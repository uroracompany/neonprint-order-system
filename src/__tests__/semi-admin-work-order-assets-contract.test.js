import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");

describe("Semi-Admin work-order asset contract", () => {
  it("forwards explicit asset removals through the authenticated command", () => {
    const handler = read("server/seller-order-actions-handler.js");
    expect(handler).toContain("removed_file_urls: removedFileUrls");
    expect(handler).toContain('asset_operation: payload.asset_operation === "manage_assets" ? "manage_assets" : null');
    expect(handler).toContain("asset_removal_only: payload.asset_removal_only === true");
  });

  it("uses the catalog plus durable outbox before deleting production metadata", () => {
    const migration = read("supabase/migrations/20260905175107_semi_admin_work_order_asset_integrity.sql");
    expect(migration).toContain("create or replace function public.semi_admin_update_order_with_assets");
    expect(migration).toContain("perform public.enqueue_admin_order_asset_deletion");
    expect(migration).toContain("delete from public.order_production_files where order_id = p_order_id and url = v_removed_url");
    expect(migration).toContain("El archivo eliminado no pertenece a esta orden.");
    expect(migration).toContain("El archivo eliminado sigue adjunto a la orden.");
    expect(migration).toContain("revoke all on function public.semi_admin_update_order_with_assets");
  });

  it("enforces the work-order requirement in the backend command", () => {
    const migration = read("supabase/migrations/20260905175107_semi_admin_work_order_asset_integrity.sql");
    expect(migration).toContain("La Orden de Trabajo es obligatoria. Adjunta la Orden de Trabajo antes de continuar.");
    expect(migration).toContain("p_asset_removal_only");
    expect(migration).toContain("v_old.preview_image = any(p_removed_file_urls)");
  });
});
