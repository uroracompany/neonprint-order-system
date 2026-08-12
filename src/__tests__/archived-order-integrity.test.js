import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(".");
const read = (path) => readFileSync(resolve(root, path), "utf8");

describe("archived participant integrity", () => {
  const migration = read("supabase/migrations/20260811000000_preserve_archived_order_participants.sql");
  const retirementHandler = read("server/admin-retirement-handler.js");
  const adminApi = read("api/admin.js");
  const clients = read("src/utils/clients.js");

  it("uses logical retirement and blocks physical identity deletion", () => {
    expect(migration).toContain("add column if not exists deleted_at");
    expect(migration).toContain("trg_prevent_profile_hard_delete");
    expect(migration).toContain("trg_prevent_client_hard_delete");
    expect(adminApi).toContain('"retire-user": handleAdminRetireUser');
    expect(adminApi).not.toContain('"delete-user": handleAdminDeleteUser');
  });

  it("preserves assignment history and prevents assignment to retired employees", () => {
    expect(migration).toContain("order_participant_history");
    expect(migration).toContain("trg_capture_order_participant_history");
    expect(migration).toContain("trg_assert_active_order_participant");
    expect(migration).toContain("trg_assert_active_production_file_assignee");
  });

  it("requires an active-work preflight before an employee can be retired", () => {
    expect(retirementHandler).toContain("findOpenResponsibilities");
    expect(retirementHandler).toContain("No se puede dar de baja a este empleado hasta reasignar su trabajo activo.");
    expect(retirementHandler).toContain("ban_duration: \"876000h\"");
  });

  it("keeps retired clients out of new-order client selectors", () => {
    expect(clients).toContain('.is("deleted_at", null)');
  });
});
