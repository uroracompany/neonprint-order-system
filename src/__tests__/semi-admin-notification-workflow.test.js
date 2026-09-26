import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Semi-Administrador notification and nested asset workflow", () => {
  it("deduplicates Realtime and post-mutation refreshes for creation and assignment", () => {
    const source = readProjectFile("src/pages/pages-seller.jsx");
    const notifications = readProjectFile("src/hooks/useNotifications.js");

    expect(source).toContain('onCreated={async () => {\n          await fetchOrders({ nextPage: 1, includeDashboard: true });\n          await notif.refresh({ showNewToasts: true });');
    expect(source).toContain('setSendingToDesigner(null);\n      await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });\n      await notif.refresh({ showNewToasts: true });');
    expect(notifications).toContain("notificationsRef.current = [newNotif, ...notificationsRef.current].slice(0, MAX_NOTIFICATION_ROWS);");
  });

  it("keeps the order detail mounted when it opens the nested asset editor", () => {
    const source = readProjectFile("src/pages/pages-seller.jsx");
    const opener = source.slice(source.indexOf("onOpenDesignEditor={() =>"), source.indexOf("currentUserId=", source.indexOf("onOpenDesignEditor={() =>")));

    expect(opener).toContain("setEditingOrder(selectedOrder);");
    expect(opener).not.toContain("setSelectedOrder(null);");
  });

  it("makes each meaningful workflow confirmation green and skips asset-only saves", () => {
    const migration = readProjectFile("supabase/migrations/20260905131848_reconcile_admin_semi_admin_order_flow.sql");

    expect(migration).toContain("when 'semi_admin_order_created' then");
    expect(migration).toContain("when 'semi_admin_send_to_designer' then");
    expect(migration).toContain("when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then");
    expect(migration).toContain("when 'semi_admin_production_routed' then");
    expect(migration).toContain("'success', v_title, v_message");
    expect(migration).toContain("where key.name not in ('order_file_url', 'preview_image', 'reference_images')");
  });

  it("does not emit a second generic Semi-Admin toast after the backend confirmation", () => {
    const source = readProjectFile("src/pages/pages-seller.jsx");
    expect(source).not.toContain('showToast("Acción operativa registrada.")');
  });
});
