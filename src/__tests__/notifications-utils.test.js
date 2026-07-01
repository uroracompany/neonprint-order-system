import { describe, expect, it, vi } from "vitest";
import {
  showCreditActionFeedback,
  isAdminEditNotification,
  getAdminEditedOrderIds,
  buildPendingReviewFromNotifications,
} from "../utils/notifications";

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

  describe("isAdminEditNotification", () => {
    it("detecta notificacion con event_kind admin_order_edit_area_notice", () => {
      const notification = {
        metadata: { event_kind: "admin_order_edit_area_notice" },
      };
      expect(isAdminEditNotification(notification)).toBe(true);
    });

    it("detecta notificacion con event_kind admin_edited_order", () => {
      const notification = {
        metadata: { event_kind: "admin_edited_order" },
      };
      expect(isAdminEditNotification(notification)).toBe(true);
    });

    it("detecta notificacion con source_module admin", () => {
      const notification = {
        metadata: { source_module: "admin" },
      };
      expect(isAdminEditNotification(notification)).toBe(true);
    });

    it("rechaza notificacion sin metadata", () => {
      expect(isAdminEditNotification({})).toBe(false);
      expect(isAdminEditNotification(null)).toBe(false);
      expect(isAdminEditNotification(undefined)).toBe(false);
    });

    it("rechaza notificacion de evento no admin", () => {
      const notification = {
        metadata: { event_kind: "order_created", source_module: "sales" },
      };
      expect(isAdminEditNotification(notification)).toBe(false);
    });
  });

  describe("getAdminEditedOrderIds", () => {
    const orderId1 = "order-111";
    const orderId2 = "order-222";

    it("retorna IDs de ordenes con notificaciones admin activas", () => {
      const notifications = [
        { id: "n1", order_id: orderId1, metadata: { event_kind: "admin_order_edit_area_notice" }, is_archived: false, deleted_at: null },
        { id: "n2", order_id: orderId2, metadata: { source_module: "admin" }, is_archived: false, deleted_at: null },
      ];
      const ids = getAdminEditedOrderIds(notifications);
      expect(ids.has(orderId1)).toBe(true);
      expect(ids.has(orderId2)).toBe(true);
      expect(ids.size).toBe(2);
    });

    it("excluye notificaciones archivadas", () => {
      const notifications = [
        { id: "n1", order_id: orderId1, metadata: { event_kind: "admin_order_edit_area_notice" }, is_archived: true, deleted_at: null },
      ];
      const ids = getAdminEditedOrderIds(notifications);
      expect(ids.size).toBe(0);
    });

    it("retorna Set vacio si no hay notificaciones admin", () => {
      const notifications = [
        { id: "n1", order_id: orderId1, metadata: { event_kind: "order_created" }, is_archived: false, deleted_at: null },
      ];
      const ids = getAdminEditedOrderIds(notifications);
      expect(ids.size).toBe(0);
    });

    it("retorna Set vacio para lista vacia", () => {
      const ids = getAdminEditedOrderIds([]);
      expect(ids.size).toBe(0);
    });
  });

  describe("buildPendingReviewFromNotifications", () => {
    const orderId = "order-123";
    const baseNotif = {
      id: "n1",
      order_id: orderId,
      is_archived: false,
      deleted_at: null,
    };

    it("retorna pendingReview con label y changed_fields de una notificacion admin", () => {
      const notif = {
        ...baseNotif,
        metadata: {
          event_kind: "admin_order_edit_area_notice",
          changed_fields: [
            { field: "description", label: "Descripcion" },
          ],
        },
      };
      const result = buildPendingReviewFromNotifications([notif], orderId);
      expect(result).not.toBeNull();
      expect(result.label).toBe("Editada por admin");
      expect(result.changed_fields).toEqual([{ field: "description", label: "Descripcion" }]);
      expect(result.order_id).toBe(orderId);
    });

    it("agrega changed_fields de multiples notificaciones admin deduplicando por label", () => {
      const notifs = [
        {
          ...baseNotif,
          metadata: {
            event_kind: "admin_order_edit_area_notice",
            changed_fields: [{ field: "description", label: "Descripcion" }],
          },
        },
        {
          ...baseNotif,
          id: "n2",
          metadata: {
            event_kind: "admin_order_edit_area_notice",
            changed_fields: [{ field: "material", label: "Material" }],
          },
        },
        {
          ...baseNotif,
          id: "n3",
          metadata: {
            event_kind: "admin_order_edit_area_notice",
            changed_fields: [{ field: "description", label: "Descripcion" }],
          },
        },
      ];
      const result = buildPendingReviewFromNotifications(notifs, orderId);
      expect(result.changed_fields).toHaveLength(2);
      expect(result.changed_fields).toEqual(
        expect.arrayContaining([
          { field: "description", label: "Descripcion" },
          { field: "material", label: "Material" },
        ])
      );
    });

    it("retorna null si la orden fue vista (seenOrderIds)", () => {
      const notif = {
        ...baseNotif,
        metadata: {
          event_kind: "admin_order_edit_area_notice",
          changed_fields: [{ field: "description", label: "Descripcion" }],
        },
      };
      const result = buildPendingReviewFromNotifications([notif], orderId, { [orderId]: Date.now() });
      expect(result).toBeNull();
    });

    it("retorna null si no hay notificaciones admin para la orden", () => {
      const notif = {
        ...baseNotif,
        metadata: { event_kind: "order_created" },
      };
      const result = buildPendingReviewFromNotifications([notif], orderId);
      expect(result).toBeNull();
    });

    it("retorna null si el orderId es nulo", () => {
      const result = buildPendingReviewFromNotifications([], null);
      expect(result).toBeNull();
    });

    it("limita changed_fields a 4 labels", () => {
      const labels = ["A", "B", "C", "D", "E"];
      const notifs = labels.map((l, i) => ({
        ...baseNotif,
        id: `n${i}`,
        metadata: {
          event_kind: "admin_order_edit_area_notice",
          changed_fields: [{ field: l.toLowerCase(), label: l }],
        },
      }));
      const result = buildPendingReviewFromNotifications(notifs, orderId);
      expect(result.changed_fields).toHaveLength(5);
      // The slice(0, 4) is only for display, not stored
      expect(result.changed_fields).toHaveLength(5);
    });
  });
});
