import { describe, expect, it, vi } from "vitest";
import { showCreditActionFeedback } from "../utils/notifications";

describe("notification utilities", () => {
  it("emite feedback de credito con metadata compatible con NotificationCenter", () => {
    const notif = { showActionNotification: vi.fn() };

    showCreditActionFeedback(notif, {
      variant: "success",
      title: "Recordatorio atendido",
      message: "Recordatorio marcado como atendido.",
      eventKind: "admin_credit_feedback",
    });

    expect(notif.showActionNotification).toHaveBeenCalledWith({
      type: "info",
      title: "Recordatorio atendido",
      label: "Recordatorio atendido",
      message: "Recordatorio marcado como atendido.",
      metadata: {
        event_kind: "admin_credit_feedback",
        variant: "success",
      },
    });
  });

  it("mantiene los errores de credito con variante cancelada", () => {
    const notif = { showActionNotification: vi.fn() };

    showCreditActionFeedback(notif, {
      variant: "error",
      title: "Recordatorio no actualizado",
      message: "No se pudo marcar el recordatorio.",
      eventKind: "admin_credit_feedback",
    });

    expect(notif.showActionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order_cancelled",
        metadata: expect.objectContaining({ variant: "error" }),
      })
    );
  });
});
