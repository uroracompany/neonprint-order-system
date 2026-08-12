import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import { Icons } from "../utils/icons";

const makeNotification = (overrides = {}) => ({
  id: "notification-1",
  type: "info",
  title: "Nueva asignacion",
  message: "Tienes una orden pendiente de revisión.",
  order_id: "12345678-1234-4234-9234-123456789abc",
  metadata: { variant: "info" },
  created_at: new Date("2026-06-17T12:00:00Z").toISOString(),
  is_read: false,
  is_archived: false,
  deleted_at: null,
  ...overrides,
});

describe("DesignerNotificationsModule", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders active notifications and calls active actions", () => {
    const onMarkAsRead = vi.fn();
    const onMarkAllAsRead = vi.fn();
    const onArchive = vi.fn();

    render(
      <DesignerNotificationsModule
        notifications={[makeNotification()]}
        archivedNotifications={[]}
        unreadCount={1}
        onMarkAsRead={onMarkAsRead}
        onMarkAllAsRead={onMarkAllAsRead}
        onArchive={onArchive}
      />
    );

    expect(screen.getByText("Nueva asignacion")).toBeInTheDocument();
    expect(screen.getByText("Sin leer")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activas/ }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Archivadas/ }).querySelector("svg")).toBeTruthy();

    fireEvent.click(screen.getByText("Marcar leídas"));
    expect(onMarkAllAsRead).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Marcar como leída"));
    expect(onMarkAsRead).toHaveBeenCalledWith("notification-1");

    fireEvent.click(screen.getByTitle("Archivar"));
    expect(onArchive).toHaveBeenCalledWith("notification-1");
  });

  it("adapts its contextual copy and order badge for Delivery without changing notification actions", () => {
    const onArchive = vi.fn();

    render(
      <DesignerNotificationsModule
        notifications={[makeNotification({ type: "order_assigned" })]}
        archivedNotifications={[]}
        unreadCount={1}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={onArchive}
        moduleLabel="Entrega"
        moduleIcon={Icons.Truck}
        moduleTone="delivery"
      />
    );

    expect(screen.getByText("Módulo de entrega")).toBeInTheDocument();
    expect(screen.getByText("En bandeja de entrega")).toBeInTheDocument();
    expect(screen.getByText("Entrega")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Archivar"));
    expect(onArchive).toHaveBeenCalledWith("notification-1");
  });

  it("renders archived notifications without mutable actions", () => {
    const onDelete = vi.fn();
    render(
      <DesignerNotificationsModule
        notifications={[]}
        archivedNotifications={[
          makeNotification({
            id: "archived-notification",
            title: "Orden archivada",
            type: "order_assigned",
            is_read: true,
            is_archived: true,
          }),
        ]}
        unreadCount={0}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Archivadas/ }));

    expect(screen.getByText("Orden archivada")).toBeInTheDocument();
    expect(screen.getByText("Archivada")).toBeInTheDocument();
    expect(screen.getByText("Diseño")).toBeInTheDocument();
    expect(screen.getAllByText("Asignada").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTitle("Marcar como leída")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Archivar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Eliminar notificación"));
    expect(screen.getByText("Eliminar notificación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Eliminar$/ }));
    expect(onDelete).toHaveBeenCalledWith("archived-notification");
  });

  it("renders a read status badge for active read notifications", () => {
    render(
      <DesignerNotificationsModule
        notifications={[makeNotification({ id: "read-notification", title: "Vista previa revisada", is_read: true })]}
        archivedNotifications={[]}
        unreadCount={0}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    expect(screen.getByText("Vista previa revisada")).toBeInTheDocument();
    expect(screen.getByText(/Le.da/)).toBeInTheDocument();
    expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
  });

  it("shows empty states for active and archived tabs", () => {
    render(
      <DesignerNotificationsModule
        notifications={[]}
        archivedNotifications={[]}
        unreadCount={0}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    expect(screen.getByText("Sin notificaciones activas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Archivadas/ }));
    expect(screen.getByText("Sin notificaciones archivadas")).toBeInTheDocument();
  });

  it("filters notifications by search text and type", () => {
    render(
      <DesignerNotificationsModule
        notifications={[
          makeNotification({ id: "design-1", title: "Nueva asignacion", type: "new_order" }),
          makeNotification({
            id: "design-2",
            title: "Correccion requerida",
            message: "El cliente devolvio el arte para ajuste.",
            type: "order_returned",
            metadata: { variant: "warning" },
          }),
        ]}
        archivedNotifications={[]}
        unreadCount={2}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Buscar notificaciones"), { target: { value: "correccion" } });
    expect(screen.getByText("Correccion requerida")).toBeInTheDocument();
    expect(screen.queryByText("Nueva asignacion")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Buscar notificaciones"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por tipo"), { target: { value: "order_returned" } });
    expect(screen.getByText("Correccion requerida")).toBeInTheDocument();
    expect(screen.queryByText("Nueva asignacion")).not.toBeInTheDocument();
  });

  it("filters notifications by preset and custom date ranges", () => {
    const today = new Date().toISOString();

    render(
      <DesignerNotificationsModule
        notifications={[
          makeNotification({ id: "today", title: "Aviso de hoy", created_at: today }),
          makeNotification({ id: "old", title: "Aviso antiguo", created_at: "2020-01-15T12:00:00Z" }),
        ]}
        archivedNotifications={[]}
        unreadCount={2}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Filtrar por fecha"), { target: { value: "today" } });
    expect(screen.getByText("Aviso de hoy")).toBeInTheDocument();
    expect(screen.queryByText("Aviso antiguo")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filtrar por fecha"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Fecha desde"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("Fecha hasta"), { target: { value: "2020-01-31" } });
    expect(screen.getByText("Aviso antiguo")).toBeInTheDocument();
    expect(screen.queryByText("Aviso de hoy")).not.toBeInTheDocument();
  });

  it("paginates notifications in groups of fifteen", () => {
    render(
      <DesignerNotificationsModule
        notifications={Array.from({ length: 16 }, (_, index) => makeNotification({
          id: `notification-${index + 1}`,
          title: `Aviso ${index + 1}`,
          created_at: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T12:00:00Z`).toISOString(),
        }))}
        archivedNotifications={[]}
        unreadCount={16}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByText("Aviso 1")).toBeInTheDocument();
    expect(screen.queryByText("Aviso 16")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByText("Aviso 16")).toBeInTheDocument();
  });

  it("confirms bulk notification deletion from the actions menu", () => {
    const onDeleteAll = vi.fn();

    render(
      <DesignerNotificationsModule
        notifications={[makeNotification({ id: "active-1" })]}
        archivedNotifications={[makeNotification({ id: "archived-1", is_archived: true })]}
        unreadCount={1}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
        onDeleteAll={onDeleteAll}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Limpiar/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Eliminar archivadas" }));
    expect(screen.getByText("Eliminar notificaciones archivadas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Eliminar archivadas/ }));
    expect(onDeleteAll).toHaveBeenCalledWith("archived");
  });

  it("identifies credit messages and opens their tracking destination when requested", () => {
    const onOpenCreditTracking = vi.fn();
    const notification = makeNotification({
      id: "credit-summary",
      title: "Resumen diario de créditos",
      metadata: { event_kind: "admin_credit_daily_summary" },
    });

    render(
      <DesignerNotificationsModule
        notifications={[notification]}
        archivedNotifications={[]}
        unreadCount={1}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onArchive={vi.fn()}
        onOpenCreditTracking={onOpenCreditTracking}
      />
    );

    expect(screen.getByText("Crédito")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver seguimiento" }));
    expect(onOpenCreditTracking).toHaveBeenCalledWith(notification);
  });
});
