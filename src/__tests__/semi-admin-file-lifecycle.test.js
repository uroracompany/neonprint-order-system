import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(".");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("SemiAdmin file lifecycle contract", () => {
  it("exposes the lifecycle authorization and protects active files in SQL", () => {
    const migration = read("supabase/migrations/20260922170134_semi_admin_file_lifecycle_management.sql");

    expect(migration).toContain("semi_admin_can_manage_order_assets");
    expect(migration).toContain("'in_Quote', 'in_Production', 'in_Termination', 'in_Completed'");
    expect(migration).toContain("v_order.delivery_id = v_actor");
    expect(migration).toContain("lower(coalesce(active_file.status, 'pending')) <> 'pending'");
    expect(migration).toContain("El archivo está en proceso y no puede reemplazarse ni eliminarse");
    expect(migration).toContain("La gestión de archivos solo puede modificar archivos y referencias.");
    expect(migration).toContain("v_old_file_urls <@ v_final_file_urls");
    expect(migration).toContain("v_old_reference_urls <@ v_final_reference_urls");
    expect(migration).toContain("La vista previa está en proceso y no puede reemplazarse ni eliminarse en esta etapa.");
    expect(migration).toContain("No se puede cambiar la identidad o el estado de un archivo que está en proceso.");
    expect(migration).toContain("No se puede reasignar el área de un archivo que está en proceso.");
    expect(migration).toContain("En esta etapa solo se permiten operaciones de gestión de archivos.");
    expect(migration).toContain("'manage_design_assets'");
  });

  it("keeps production operational commands outside the asset editor", () => {
    const migration = read("supabase/migrations/20260922170134_semi_admin_file_lifecycle_management.sql");

    expect(migration).toContain("'production_file_status', 'reassign_production_file'");
    expect(migration).toContain("Semi-Administración no puede gestionar Producción.");
  });

  it("allows asset-only edits in quote and completed states while preserving seller restrictions", () => {
    const handler = read("server/seller-order-actions-handler.js");
    const modal = read("src/components/orders/EditOrderModal.jsx");

    expect(handler).toContain("const assetOperation = isSemiAdminProfile(auth.profile) && payload.asset_operation === \"manage_assets\";");
    expect(handler).toContain("SEMI_ADMIN_ASSET_FIELDS.has(field)");
    expect(handler).toContain("SEMI_ADMIN_ASSET_EDITABLE_STATUSES.has(normalizeText(order?.status))");
    expect(handler).toContain("const commandProductionFileRows = assetOperation");
    expect(handler).toContain("new_production_files: commandProductionFileRows");
    expect(modal).toContain("SEMI_ADMIN_ASSET_EDITABLE_STATUSES");
    expect(modal).toContain("SEMI_ADMIN_ACTIVE_FILE_LOCK_STATUSES");
    expect(modal).toContain("canMutateExistingAsset");
  });

  it("keeps the participant fields and delivery catalogue gate aligned", () => {
    const handler = read("server/seller-order-actions-handler.js");
    const panel = read("src/components/orders/SemiAdminOperationalPanel.jsx");
    const catalogMigration = read("supabase/migrations/20260923100000_align_semi_admin_participant_catalog.sql");

    expect(handler).toContain('const SEMI_ADMIN_PARTICIPANT_FIELDS = ["created_by", "seller_id", "designer_id", "quote_id", "delivery_id"];');
    expect(handler).toContain("const isSemiAdminParticipant = (order, profile)");
    expect(handler).toContain("const canSemiAdminConfirmDelivery = (order, profile)");
    expect(handler).toContain('catalog.actions = (catalog.actions || []).filter((action) => action?.key !== "mark_delivered");');
    expect(panel).toContain("const isProtectedProductionStage = [\"in_Production\", \"in_Termination\", \"in_Completed\"]");
    expect(panel).toContain("Estado productivo protegido");
    expect(panel).toContain("Solo lectura:");
    expect(catalogMigration).toContain("v_delivery_responsible := v_order.delivery_id = v_actor;");
    expect(catalogMigration).toContain("Solo el responsable asignado a Entrega puede confirmar esta orden.");
    expect(catalogMigration).toContain("semi_admin_can_manage_order_assets(p_order_id)");
  });

  it("disables invalid standalone and area mutations before submit", () => {
    const modal = read("src/components/orders/EditOrderModal.jsx");
    const detailsModal = read("src/components/orders/CreateOrderModal.jsx");

    expect(modal).toContain("const existingPreviewLocked = Boolean");
    expect(modal).toContain("disabled={existingPreviewLocked}");
    expect(modal).toContain("disabled={!canMutateStandaloneAsset}");
    expect(modal).toContain("lockArea={Boolean(selectedExistingDetailsFile");
    expect(detailsModal).toContain("lockArea = false");
    expect(detailsModal).toContain("areaDisabled={!draft.publicLabel?.trim() || lockArea}");
  });
});
