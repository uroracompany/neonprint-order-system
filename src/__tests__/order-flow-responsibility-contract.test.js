import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("responsibility and Caja routing contract", () => {
  const assignModal = read("src/components/ui/AssignModal.jsx");
  const dashboard = read("src/pages/dashboard.jsx");
  const sellerWorkbench = read("src/pages/pages-seller.jsx");
  const migration = read("supabase/migrations/20260905131848_reconcile_admin_semi_admin_order_flow.sql");

  it("hides self-assignment from the real current responsible user", () => {
    expect(assignModal).toContain("currentResponsibleId = \"\"");
    expect(assignModal).toContain("const isCurrentUserResponsible");
    expect(assignModal).toContain("!isCurrentUserResponsible");
    expect(sellerWorkbench).toContain("currentResponsibleId={sendingToDesigner?.designer_id || \"\"}");
  });

  it("allows an Admin to leave Caja unselected and persists the actor as quote responsible", () => {
    expect(dashboard).toContain('allowUnassigned={assigningRole === "quote"}');
    expect(dashboard).toContain("payload: userId ? { target_user_id: userId } : {}");
    expect(migration).toContain("quote_id = v_actor");
    expect(migration).toContain("admin_route_quote_to_actor_command");
    expect(migration).toContain("p.role = 'admin'");
  });
});
