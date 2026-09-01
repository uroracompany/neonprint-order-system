import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260829155534_designer_required_assets_guard.sql"),
  "utf8",
);
const designerPage = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");

describe("designer required assets guard", () => {
  it("keeps preview removal versioned and routed through the durable cleanup outbox", () => {
    expect(migration).toContain("create or replace function public.designer_remove_order_preview(");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("perform public.enqueue_admin_order_asset_deletion(");
    expect(migration).toContain("'order-previews'");
    expect(migration).toContain("event_type, old_status, new_status");
    expect(migration).toContain("designer_preview_removed");
  });

  it("enforces both a manifest-backed design file and a manifest-backed preview before Caja", () => {
    expect(migration).toContain("Falta una orden de trabajo valida. Adjuntala antes de enviar a Caja.");
    expect(migration).toContain("Falta un archivo de diseno valido. Adjuntalo antes de enviar a Caja.");
    expect(migration).toContain("join public.order_production_files pf");
    expect(migration).toContain("join public.order_files f");
  });

  it("keeps the generic writer additive and manifest-backed", () => {
    expect(migration).toContain("create or replace function public.designer_update_order_assets(");
    expect(migration).toContain("Usa el comando de retirada para eliminar un archivo existente.");
    expect(migration).toContain("Usa el comando de retirada para reemplazar la orden de trabajo existente.");
    expect(migration).toContain("Archivo de diseno invalido o no asociado a la orden.");
    expect(migration).toContain("f.category = 'design' and f.status = 'uploaded' and f.deleted_at is null");
    expect(migration).toContain("if jsonb_typeof(v_next_urls) = 'string' then");
    expect(migration).toContain("v_next_urls := (v_next_urls #>> '{}')::jsonb;");
    expect(migration).toContain("revoke all on function public.designer_update_order_assets(uuid, timestamptz, jsonb, jsonb) from public, anon;");
  });

  it("uses the PostgreSQL capture-group replacement for legacy Supabase URLs", () => {
    expect(migration).toContain(String.raw`'\1'`);
    expect(migration).not.toContain(String.raw`'\\1'`);
  });

  it("derives the frontend eligibility from the effective asset set while removal is in flight", () => {
    expect(designerPage).not.toContain("window.confirm(");
    expect(designerPage).toContain("const hasRequiredAssets = effectivePersistedFiles.length + pendingFiles.length > 0 && hasPreview;");
    expect(designerPage).toContain("const hasPersistedRequiredAssets = effectivePersistedFiles.length > 0 && hasPersistedPreview;");
    expect(designerPage).toContain("disabled={!canSaveChanges}");
    expect(designerPage).toContain('rpc("designer_remove_order_preview", {');
  });
});
