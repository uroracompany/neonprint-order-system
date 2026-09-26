import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Semi-Admin notification type contract", () => {
  it("keeps success as presentation metadata rather than an invalid notification category", () => {
    const migration = readProjectFile("supabase/migrations/20260905160000_fix_semi_admin_notification_type_contract.sql");

    expect(migration).toContain("'info',");
    expect(migration).toContain("'variant', 'success'");
    expect(migration).not.toContain("new.actor_id, 'success'");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("preserves the UI contract that renders an info notification with a success variant in green", () => {
    const notificationCenter = readProjectFile("src/components/NotificationCenter.jsx");

    expect(notificationCenter).toContain('success: "completed"');
    expect(notificationCenter).toContain("getTypeClass(notification.type, notification.metadata?.variant)");
  });
});
