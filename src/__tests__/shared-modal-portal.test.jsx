import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../components/orders/CreateOrderModal";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

function NestedModal({ onClose = () => {} }) {
  return (
    <div data-testid="nested-host">
      <Modal open onClose={onClose} title="Detalle de orden" wide closeOnBackdrop closeOnEscape>
        <button type="button">Accion interna</button>
      </Modal>
    </div>
  );
}

function ClosingHarness() {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="nested-host">
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Detalle de orden"
        closeOnBackdrop
        closeOnEscape
      >
        <button type="button">Accion interna</button>
      </Modal>
    </div>
  );
}

function renderReact(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

describe("shared Modal portal behavior", () => {
  it("monta el overlay en document.body aunque se renderice dentro de un contenedor anidado", async () => {
    const view = renderReact(<NestedModal />);

    await act(async () => {
      await nextFrame();
    });

    const host = view.container.querySelector("[data-testid='nested-host']");
    const overlay = document.body.querySelector(".ps-modal-overlay");
    const dialog = document.body.querySelector("[role='dialog']");
    const closeButton = document.body.querySelector("[aria-label='Cerrar modal']");

    expect(overlay).toBeTruthy();
    expect(overlay.parentElement).toBe(document.body);
    expect(host.contains(overlay)).toBe(false);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Detalle de orden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(closeButton);

    view.unmount();
  });

  it("cierra por Escape, desmonta el portal y restaura el scroll", async () => {
    renderReact(<ClosingHarness />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector(".ps-modal-overlay")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("cierra al hacer click en el backdrop sin depender del arbol local", async () => {
    renderReact(<ClosingHarness />);

    act(() => {
      document
        .body
        .querySelector(".ps-modal-overlay")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector(".ps-modal-overlay")).toBeNull();
  });
});
