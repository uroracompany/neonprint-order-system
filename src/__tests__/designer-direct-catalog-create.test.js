import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");
const migration = readFileSync(
  resolve("supabase/migrations/20261020031249_allow_designer_material_insert.sql"),
  "utf8",
);
const canonicalPolicy = readFileSync(
  resolve("supabase/migrations/20260922160910_semi_admin_history_verified_quote_return.sql"),
  "utf8",
);

describe("designer direct client and material creation", () => {
  it("opens standalone client and material forms from the Designer header", () => {
    expect(page).toContain('aria-label="Nuevo cliente"');
    expect(page).toContain('onClick={() => setShowNewClientModal(true)}');
    expect(page).toContain('aria-label="Crear materiales"');
    expect(page).toContain("onClick={openMaterialModal}");
    expect(page).toContain("<CreateClientModal");
    expect(page).toContain("<MaterialFormModal");
  });

  it("keeps direct client creation separate while preserving order-selector behavior", () => {
    expect(page).toContain('onAddNewClient={() => setShowNewClientModal(true)}');
    expect(page).toContain("if (showCreate) setClientToSelectInOrderForm(newClient)");
    expect(page).toContain("setClients((previous) => {");
  });

  it("restricts material form areas to active areas and validates before insert", () => {
    expect(page).toContain('.from("production_areas").select("code,label").eq("is_active", true)');
    expect(page).toContain("normalizedName.length < 2");
    expect(page).toContain("if (!activeArea)");
    expect(page).toContain('.from("materials").insert({');
    expect(page).toContain("production_area_code: activeArea.code");
  });

  it("keeps duplicate, permission, and retryable failures in the open form", () => {
    expect(page).toContain('error.code === "23505"');
    expect(page).toContain('error.code === "42501"');
    expect(page).toContain("No se pudo guardar el material. Revisa tu conexión e inténtalo de nuevo.");
    expect(page).toContain("No se pudo completar la operación por un problema de conexión.");
    expect(page).toContain("materialInsertedAwaitingRefresh");
    expect(page).toContain("const catalogsLoaded = await loadDesignerCatalogs()");
    expect(page).toContain("if (!catalogsLoaded)");
    expect(page).toContain("setShowMaterialModal(false)");
  });

  it("adds only designer insert eligibility and retains the active-area guard", () => {
    expect(canonicalPolicy).toContain("create policy materials_insert_admin");
    expect(migration).toContain("drop policy if exists materials_insert_admin on public.materials");
    expect(migration).toContain("public.current_profile_role() in ('admin', 'semi_admin', 'designer')");
    expect(migration).toContain("production_area_code is not null");
    expect(migration).toContain("where area.code = production_area_code and area.is_active");
    expect(migration).not.toMatch(/create policy .*materials_(update|delete)/i);
    expect(migration).not.toContain("clients_");
  });
});
