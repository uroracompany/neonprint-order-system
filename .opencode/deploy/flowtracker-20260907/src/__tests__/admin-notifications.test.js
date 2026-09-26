/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("admin notification visibility", () => {
  it("filters admin notifications and unread count before rendering NotificationCenter", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain("filterActiveNotifications");
    expect(dashboard).toContain("getActiveUnreadCount");
    expect(dashboard).toContain("const adminVisibleNotifications = useMemo");
    expect(dashboard).toContain("const adminVisibleToasts = useMemo");
    expect(dashboard).toContain("const adminUnreadCount = useMemo");
    expect(dashboard).toContain("notifications={adminVisibleNotifications}");
    expect(dashboard).toContain("unreadCount={adminUnreadCount}");
    expect(dashboard).toContain("toasts={adminVisibleToasts}");
    expect(dashboard).not.toContain("notifications={notif.notifications}");
    expect(dashboard).not.toContain("unreadCount={notif.unreadCount}");
  });
});
