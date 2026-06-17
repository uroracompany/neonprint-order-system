import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
