import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(resolve("src/pages/dashboard.jsx"), "utf8");

const employeeHandler = (start, end) => dashboard.slice(
  dashboard.indexOf(start),
  dashboard.indexOf(end),
);

describe("employee success notifications", () => {
  it("uses the existing green action-notification convention after user creation", () => {
    const handler = employeeHandler("const handleCreateUser", "const handleUpdateUser");

    expect(handler).toContain("if (!response.ok)");
    expect(handler).toContain("notif.showActionNotification");
    expect(handler).toContain('title: "Usuario creado"');
    expect(handler).toContain("Usuario ${trimmedName} creado correctamente.");
    expect(handler).toContain('variant: "success"');
    expect(handler).toContain('event_kind: "admin_user_created"');
    expect(handler).not.toContain('showFeedback("success"');
  });

  it("emits a named green action notification after user update", () => {
    const handler = employeeHandler("const handleUpdateUser", "const handleSaveUser");

    expect(handler).toContain("if (!response.ok)");
    expect(handler).toContain("notif.showActionNotification");
    expect(handler).toContain('title: "Usuario actualizado"');
    expect(handler).toContain("Usuario ${getUserDisplayName(updatedUser)} actualizado correctamente.");
    expect(handler).toContain('variant: "success"');
    expect(handler).toContain('event_kind: "admin_user_updated"');
    expect(handler).not.toContain('showFeedback("success"');
  });

  it("emits named green notifications only after activation or deactivation succeeds", () => {
    const handler = employeeHandler("const handleEmploymentStatusChange", "const confirmEmploymentStatusChange");

    expect(handler).toContain("if (!response.ok)");
    expect(handler).toContain("notif.showActionNotification");
    expect(handler).toContain('variant: "success"');
    expect(handler).toContain('event_kind: nextStatus ? "admin_user_activated" : "admin_user_deactivated"');
    expect(handler).toContain("Usuario ${userName} ${nextStatus ? \"activado\" : \"desactivado\"} correctamente.");
    expect(handler).not.toContain('showFeedback("success"');
  });
});
