import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationCenter from "../components/NotificationCenter";

const baseProps = {
  notifications: [],
  unreadCount: 0,
  onMarkAsRead: vi.fn(),
  onMarkAllAsRead: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
};

const toasts = [
  { id: "success", type: "order_completed", title: "Exito", message: "Orden enviada a Caja." },
  { id: "error", type: "order_cancelled", title: "Error", message: "No se pudo asignar." },
  { id: "warning", type: "order_updated", title: "Advertencia", message: "Revisa la orden." },
  { id: "info", type: "info", title: "Info", message: "Notificacion informativa." },
];

const notifications = [
  {
    id: "notification-1",
    type: "info",
    title: "Info",
    message: "Notificacion persistente.",
    created_at: new Date("2026-06-17T12:00:00Z").toISOString(),
    is_archived: false,
    deleted_at: null,
    is_read: false,
  },
];

const variantToasts = [
  { id: "variant-success", type: "info", title: "Success variant", message: "Cliente registrado.", metadata: { variant: "success" } },
  { id: "variant-error", type: "info", title: "Error variant", message: "Error controlado.", metadata: { variant: "error" } },
  { id: "variant-warning", type: "info", title: "Warning variant", message: "Advertencia controlada.", metadata: { variant: "warning" } },
  { id: "variant-info", type: "info", title: "Info variant", message: "Info controlada.", metadata: { variant: "info" } },
];

describe("NotificationCenter", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders floating toasts in document.body so modal stacking contexts cannot cover them", () => {
    const onDismissToast = vi.fn();
    const { container } = render(
      <div data-testid="header-stacking-context" style={{ position: "sticky", zIndex: 15, backdropFilter: "blur(18px)" }}>
        <NotificationCenter {...baseProps} toasts={toasts} onDismissToast={onDismissToast} />
      </div>
    );

    const stack = document.body.querySelector(".nc-toast-stack");
    expect(stack).toBeInTheDocument();
    expect(stack.parentElement).toBe(document.body);
    expect(container.querySelector(".nc-toast-stack")).toBeNull();
    expect(getComputedStyle(stack).fontFamily).toContain("Poppins");

    const successToast = screen.getByText("Exito").closest(".nc-toast");
    expect(successToast).toHaveClass("completed");
    expect(getComputedStyle(successToast).fontFamily).toContain("Poppins");
    expect(screen.getByText("Error").closest(".nc-toast")).toHaveClass("cancelled");
    expect(screen.getByText("Advertencia").closest(".nc-toast")).toHaveClass("updated");
    expect(screen.getByText("Info").closest(".nc-toast")).toHaveClass("info");

    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" })[0]);
    expect(onDismissToast).toHaveBeenCalledWith("success");
  });

  it("uses Poppins for the notification bell panel and persistent notification items", () => {
    render(
      <NotificationCenter
        {...baseProps}
        notifications={notifications}
        unreadCount={1}
        toasts={[]}
        onDismissToast={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));

    expect(getComputedStyle(document.querySelector(".nc-bell-wrap")).fontFamily).toContain("Poppins");
    expect(getComputedStyle(document.querySelector(".nc-panel")).fontFamily).toContain("Poppins");
    expect(getComputedStyle(document.querySelector(".nc-item")).fontFamily).toContain("Poppins");
    expect(getComputedStyle(document.querySelector(".nc-link-btn")).fontFamily).toContain("Poppins");
  });

  it("keeps designer notification modal styling independent from section theme variables", () => {
    render(
      <div
        style={{
          "--surface": "#111827",
          "--border": "#7c3aed",
          "--text": "#fef2f2",
          "--text-sub": "#fde68a",
          "--text-muted": "#f97316",
          "--primary": "#dc2626",
        }}
      >
        <NotificationCenter
          {...baseProps}
          notifications={notifications}
          unreadCount={1}
          toasts={[]}
          onDismissToast={vi.fn()}
        />
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));

    expect(getComputedStyle(document.querySelector(".nc-bell-btn")).width).toBe("40px");
    expect(getComputedStyle(document.querySelector(".nc-bell-btn")).borderTopColor).not.toBe("rgb(124, 58, 237)");
    expect(getComputedStyle(document.querySelector(".nc-panel")).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(document.querySelector(".nc-panel")).borderTopColor).toBe("rgb(221, 227, 239)");
    expect(getComputedStyle(document.querySelector(".nc-panel-head strong")).color).toBe("rgb(15, 30, 64)");
    expect(getComputedStyle(document.querySelector(".nc-item-msg")).color).toBe("rgb(74, 94, 128)");
  });

  it("renders unread count as a badge and keeps mark-all as an icon button", () => {
    const onMarkAllAsRead = vi.fn();
    render(
      <NotificationCenter
        {...baseProps}
        notifications={notifications}
        unreadCount={1}
        toasts={[]}
        onDismissToast={vi.fn()}
        onMarkAllAsRead={onMarkAllAsRead}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));

    const unreadBadge = screen.getByText("1 sin leer");
    const markAllButton = screen.getByRole("button", { name: "Marcar todas como leídas" });

    expect(unreadBadge).toHaveClass("nc-unread-badge");
    expect(unreadBadge.querySelector("svg")).toBeInTheDocument();
    expect(getComputedStyle(unreadBadge).fontWeight).toBe("600");
    expect(getComputedStyle(unreadBadge).backgroundColor).toBe("rgb(239, 246, 255)");
    expect(getComputedStyle(unreadBadge).borderTopColor).toBe("rgb(191, 219, 254)");
    expect(getComputedStyle(unreadBadge).color).toBe("rgb(30, 64, 175)");
    expect(markAllButton.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(markAllButton);

    expect(onMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it("assigns visual action classes to notification action buttons", () => {
    render(
      <NotificationCenter
        {...baseProps}
        notifications={notifications}
        unreadCount={1}
        toasts={[]}
        onDismissToast={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));

    expect(getComputedStyle(document.querySelector(".nc-item-actions")).opacity).toBe("1");
    expect(screen.getByTitle("Marcar como leída")).toHaveClass("mark-read");
    expect(screen.getByTitle("Archivar")).toHaveClass("archive");
    expect(screen.getByTitle("Eliminar")).toHaveClass("delete");
  });

  it("keeps the notification visible and explains when an action was not persisted", async () => {
    const onArchive = vi.fn().mockResolvedValue({
      ok: false,
      message: "No se pudo archivar la notificación. La bandeja se actualizó.",
    });
    render(
      <NotificationCenter
        {...baseProps}
        notifications={notifications}
        unreadCount={1}
        toasts={[]}
        onDismissToast={vi.fn()}
        onArchive={onArchive}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));
    fireEvent.click(screen.getByTitle("Archivar"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo archivar la notificación");
    });
    expect(screen.getByText("Notificacion persistente.")).toBeInTheDocument();
    expect(onArchive).toHaveBeenCalledWith("notification-1");
  });

  it("keeps the full notifications shortcut hidden unless a destination is provided", () => {
    render(
      <NotificationCenter
        {...baseProps}
        notifications={notifications}
        unreadCount={1}
        toasts={[]}
        onDismissToast={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones, 1 sin leer" }));

    expect(screen.queryByRole("button", { name: "Ver todas las notificaciones" })).not.toBeInTheDocument();
  });

  it("renders a full notifications shortcut that calls onViewAll and closes the mini tray", () => {
    const onViewAll = vi.fn();
    render(
      <NotificationCenter
        {...baseProps}
        notifications={[]}
        unreadCount={0}
        toasts={[]}
        onDismissToast={vi.fn()}
        onViewAll={onViewAll}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));
    const viewAllButton = screen.getByRole("button", { name: "Ver todas las notificaciones" });

    expect(viewAllButton).toHaveTextContent("Ver todas");
    expect(getComputedStyle(viewAllButton).transitionProperty).not.toContain("transform");

    fireEvent.click(viewAllButton);

    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No hay notificaciones")).not.toBeInTheDocument();
  });

  it("maps generic metadata variants to the expected toast visual classes", () => {
    render(
      <NotificationCenter
        {...baseProps}
        toasts={variantToasts}
        onDismissToast={vi.fn()}
      />
    );

    expect(screen.getByText("Success variant").closest(".nc-toast")).toHaveClass("completed");
    expect(screen.getByText("Error variant").closest(".nc-toast")).toHaveClass("cancelled");
    expect(screen.getByText("Warning variant").closest(".nc-toast")).toHaveClass("returned");
    expect(screen.getByText("Info variant").closest(".nc-toast")).toHaveClass("info");
  });
});
