/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("designer notifications tab integration", () => {
  it("adds the notifications tab with the unread badge and renders the inbox module", () => {
    const page = readProjectFile("src/pages/page-designer.jsx");

    expect(page).toContain('import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule"');
    expect(page).toContain('id: "notifications"');
    expect(page).toContain('label: "Notificaciones"');
    expect(page).toContain("badge: notif.unreadCount");
    expect(page).toContain('activeTab === "notifications"');
    expect(page).toContain("<DesignerNotificationsModule");
    expect(page).toContain("archivedNotifications={notif.archivedNotifications}");
  });
});
