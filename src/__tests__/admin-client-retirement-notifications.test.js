import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(resolve("src/pages/dashboard.jsx"), "utf8");
const migration = readFileSync(resolve("supabase/migrations/20260831113000_admin_client_directory_v2_lifecycle.sql"), "utf8");

describe("client retirement notifications", () => {
  it("uses the versioned directory RPC with lifecycle state and administrator protection", () => {
    expect(migration).toContain("create or replace function public.admin_list_clients_v2");
    expect(migration).toContain("client.deleted_at");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("if not public.current_profile_is_admin()");
    expect(migration).toContain("public.admin_list_clients(");
  });

  it("emits green action notifications for create, update, and retirement", () => {
    expect(dashboard).toContain('type: "info"');
    expect(dashboard).toContain('variant: "success"');
    expect(dashboard).toContain('event_kind: isEditingClient ? "admin_client_updated" : "admin_client_created"');
    expect(dashboard).toContain('event_kind: "admin_client_retired"');
    expect(dashboard).toContain("El cliente ${deletedClient.name} fue eliminado correctamente.");
  });

  it("does not send retirement success through header feedback", () => {
    const retirementHandler = dashboard.slice(
      dashboard.indexOf("const handleConfirmDeleteClient"),
      dashboard.indexOf("const handleRestoreClient"),
    );
    expect(retirementHandler).toContain("notif.showActionNotification");
    expect(retirementHandler).not.toContain('showFeedback("success"');
  });
});
