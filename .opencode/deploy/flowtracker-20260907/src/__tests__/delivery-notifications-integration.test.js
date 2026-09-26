import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagePath = "src/pages/page-delivery.jsx";
const pageSource = readFileSync(pagePath, "utf8");

describe("Delivery notifications integration", () => {
  it("adds notifications before the profile in both navigations and opens the full inbox", () => {
    const sidebarNotifications = pageSource.indexOf('{ id: "notifications", label: "Notificaciones"');
    const sidebarProfile = pageSource.indexOf('{ id: "profile", label: "Mi Perfil"');
    const mobileNotifications = pageSource.indexOf('activeTab === "notifications"');
    const mobileProfile = pageSource.indexOf('activeTab === "profile"', mobileNotifications);

    expect(sidebarNotifications).toBeGreaterThan(-1);
    expect(sidebarNotifications).toBeLessThan(sidebarProfile);
    expect(mobileNotifications).toBeGreaterThan(-1);
    expect(mobileNotifications).toBeLessThan(mobileProfile);
    expect(pageSource).toContain('onViewAll={() => setActiveTab("notifications")}');
    expect(pageSource).toContain('activeTab === "notifications"');
    expect(pageSource).toContain('moduleLabel="Entrega"');
    expect(pageSource).toContain('moduleTone="delivery"');
    expect(pageSource).toContain('onDeleteAll={notif.deleteNotificationsByScope}');
  });

  it("keeps an accessible mobile unread indicator and responsive mobile navigation layout", () => {
    const stylesPath = "src/css-components/page-delivery.css";
    const styles = readFileSync(stylesPath, "utf8");

    expect(pageSource).toContain('aria-label={notif.unreadCount > 0 ? `Notificaciones, ${notif.unreadCount} sin leer` : "Notificaciones"}');
    expect(pageSource).toContain('pd-mobile-notification-badge');
    expect(styles).toContain('.pd-mobile-notification-badge');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  });
});
