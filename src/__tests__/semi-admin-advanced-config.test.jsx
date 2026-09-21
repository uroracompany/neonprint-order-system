import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SemiAdminOperationalPanel from "../components/orders/SemiAdminOperationalPanel";

const catalog = {
  actions: [
    { key: "manage_design_assets" },
    { key: "send_design_to_quote" },
  ],
  candidates: {
    design: [{ id: "semi-1", name: "Semi Admin" }],
    quote: [{ id: "quote-1", name: "Caja Uno" }],
  },
};

const order = {
  id: "order-1",
  status: "in_Design",
  designer_id: "semi-1",
  updated_at: "2026-09-05T13:45:00.000Z",
  order_file_url: ["supabase://order-docs/orders/order-1/design/art.pdf"],
  preview_image: "supabase://order-previews/orders/order-1/preview/work-order.png",
  order_production_files: [{
    url: "supabase://order-docs/orders/order-1/design/art.pdf",
    public_label: "Frente",
    production_area_code: "digital",
    material_names: ["Lona"],
    termination_name: "Mate",
  }],
};

const renderPanel = (nextOrder = order, props = {}) => render(
  <SemiAdminOperationalPanel
    order={nextOrder}
    currentUserId="semi-1"
    onAction={vi.fn()}
    onLoadCatalog={vi.fn().mockResolvedValue(catalog)}
    onOpenDesignEditor={vi.fn()}
    onOpenDesignReassignment={vi.fn()}
    onOpenQuoteAssignment={vi.fn()}
    onOpenQuoteResponsibilityReassignment={vi.fn()}
    onOpenOrderAssets={vi.fn()}
    onOpenProductionAssignment={vi.fn()}
    {...props}
  />
);

describe("Semi-Admin advanced configuration", () => {
  it("renders the eligible Design actions with the shared advanced button treatment", async () => {
    const { container } = renderPanel(order);

    await screen.findByText("Continuar a Caja");
    ["Reasignar Diseño", "Gestionar diseños y archivos", "Enviar a Caja"].forEach((name) => {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("sa-op-button--advanced");
      expect(button.querySelector("svg")).not.toBeNull();
    });
    expect(container.querySelectorAll(".sa-op-button--advanced")).toHaveLength(3);
  });

  it("keeps Caja hidden until both Design assets and the work order exist", async () => {
    renderPanel({ ...order, preview_image: null, order_production_files: [] });

    await screen.findByText("Para enviar la orden a Caja debes adjuntar al menos un archivo de diseño y una Orden de Trabajo.");
    expect(screen.queryByText("Continuar a Caja")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar a Caja" })).not.toBeInTheDocument();
  });

  it("opens the Caja assignment modal flow only after both required assets exist", async () => {
    const user = userEvent.setup();
    const onOpenQuoteAssignment = vi.fn();
    renderPanel(order, { onOpenQuoteAssignment });

    await screen.findByText("Continuar a Caja");
    const button = screen.getByRole("button", { name: "Enviar a Caja" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onOpenQuoteAssignment).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Responsable de Caja")).not.toBeInTheDocument();
  });

  it("refreshes eligible actions when design assets change without a timestamp update", async () => {
    const onLoadCatalog = vi.fn()
      .mockResolvedValueOnce({ actions: [{ key: "manage_design_assets" }], unavailable_actions: [] })
      .mockResolvedValueOnce(catalog);
    const { rerender } = renderPanel({
      ...order,
      order_file_url: [],
      preview_image: null,
      order_production_files: [],
    }, { onLoadCatalog });

    await screen.findByRole("button", { name: "Gestionar diseños y archivos" });
    expect(screen.queryByRole("button", { name: "Enviar a Caja" })).not.toBeInTheDocument();

    rerender(<SemiAdminOperationalPanel
      order={order}
      currentUserId="semi-1"
      onAction={vi.fn()}
      onLoadCatalog={onLoadCatalog}
      onOpenDesignEditor={vi.fn()}
      onOpenDesignReassignment={vi.fn()}
      onOpenQuoteAssignment={vi.fn()}
      onOpenQuoteResponsibilityReassignment={vi.fn()}
      onOpenOrderAssets={vi.fn()}
      onOpenProductionAssignment={vi.fn()}
    />);

    await waitFor(() => expect(onLoadCatalog).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Enviar a Caja" })).toBeVisible();
  });

  it("derives the attachment count from the shared order data without reopening details", async () => {
    const { rerender } = renderPanel(order);

    await screen.findByLabelText("2 archivos adjuntos");

    rerender(<SemiAdminOperationalPanel
      order={{
        ...order,
        reference_images: ["supabase://order-docs/orders/order-1/ref-images/reference.webp"],
      }}
      currentUserId="semi-1"
      onAction={vi.fn()}
      onLoadCatalog={vi.fn().mockResolvedValue(catalog)}
      onOpenDesignEditor={vi.fn()}
      onOpenDesignReassignment={vi.fn()}
      onOpenQuoteAssignment={vi.fn()}
      onOpenQuoteResponsibilityReassignment={vi.fn()}
      onOpenOrderAssets={vi.fn()}
      onOpenProductionAssignment={vi.fn()}
    />);
    await screen.findByLabelText("3 archivos adjuntos");

    rerender(<SemiAdminOperationalPanel
      order={{
        ...order,
        preview_image: null,
      }}
      currentUserId="semi-1"
      onAction={vi.fn()}
      onLoadCatalog={vi.fn().mockResolvedValue(catalog)}
      onOpenDesignEditor={vi.fn()}
      onOpenDesignReassignment={vi.fn()}
      onOpenQuoteAssignment={vi.fn()}
      onOpenQuoteResponsibilityReassignment={vi.fn()}
      onOpenOrderAssets={vi.fn()}
      onOpenProductionAssignment={vi.fn()}
    />);
    await screen.findByLabelText("1 archivo adjunto");
  });

  it("locks Design responsibility while there are assets and opens its modal only when empty", async () => {
    const onOpenDesignReassignment = vi.fn();
    const { rerender } = renderPanel(order, { onOpenDesignReassignment });

    await screen.findByRole("button", { name: "Reasignar Diseño" });
    expect(screen.getByRole("button", { name: "Reasignar Diseño" })).toBeDisabled();
    expect(screen.getByText(/elimina primero todos los archivos y la Orden de Trabajo/i)).toBeVisible();

    rerender(<SemiAdminOperationalPanel
      order={{ ...order, order_file_url: [], preview_image: null, order_production_files: [] }}
      currentUserId="semi-1"
      onAction={vi.fn()}
      onLoadCatalog={vi.fn().mockResolvedValue(catalog)}
      onOpenDesignEditor={vi.fn()}
      onOpenDesignReassignment={onOpenDesignReassignment}
      onOpenQuoteAssignment={vi.fn()}
      onOpenQuoteResponsibilityReassignment={vi.fn()}
      onOpenOrderAssets={vi.fn()}
      onOpenProductionAssignment={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reasignar Diseño" })).toBeEnabled());
    await userEvent.setup().click(screen.getByRole("button", { name: "Reasignar Diseño" }));
    expect(onOpenDesignReassignment).toHaveBeenCalledOnce();
  });

  it("uses only the quote modal for external-design Caja responsibility", async () => {
    const onOpenQuoteResponsibilityReassignment = vi.fn();
    renderPanel({
      ...order,
      status: "in_Quote",
      payment_status: "Pending_Payment",
      order_design_type: "EXTERNAL_DESING",
      quote_id: "quote-1",
    }, {
      onLoadCatalog: vi.fn().mockResolvedValue({
        actions: [{ key: "stage_responsibility" }],
        unavailable_actions: [],
        candidates: { quote: [{ id: "quote-1", name: "Caja Uno" }] },
      }),
      onOpenQuoteResponsibilityReassignment,
    });

    const button = await screen.findByRole("button", { name: "Cambiar responsable" });
    expect(screen.getByText("Responsable actual:")).toHaveTextContent("Caja Uno");
    expect(screen.queryByRole("button", { name: "Asignarme a mí" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reasignar responsable de Caja / Cotización")).not.toBeInTheDocument();
    await userEvent.setup().click(button);
    expect(onOpenQuoteResponsibilityReassignment).toHaveBeenCalledOnce();
  });

  it("reflects successive responsibility changes in the open advanced panel", async () => {
    const onLoadCatalog = vi.fn().mockResolvedValue({
      actions: [{ key: "stage_responsibility" }],
      unavailable_actions: [],
      candidates: {
        quote: [
          { id: "quote-1", name: "Caja Uno" },
          { id: "quote-2", name: "Caja Dos" },
          { id: "semi-1", name: "Semi Admin" },
        ],
      },
    });
    const sharedProps = {
      currentUserId: "semi-1",
      onAction: vi.fn(),
      onLoadCatalog,
      onOpenDesignEditor: vi.fn(),
      onOpenDesignReassignment: vi.fn(),
      onOpenQuoteAssignment: vi.fn(),
      onOpenQuoteResponsibilityReassignment: vi.fn(),
      onOpenOrderAssets: vi.fn(),
      onOpenProductionAssignment: vi.fn(),
    };
    const externalQuoteOrder = {
      ...order,
      status: "in_Quote",
      payment_status: "Pending_Payment",
      order_design_type: "EXTERNAL_DESING",
      quote_id: "quote-1",
    };
    const { rerender } = render(<SemiAdminOperationalPanel order={externalQuoteOrder} {...sharedProps} />);

    expect((await screen.findByText("Responsable actual:")).parentElement).toHaveTextContent("Caja Uno");

    rerender(<SemiAdminOperationalPanel order={{ ...externalQuoteOrder, quote_id: "quote-2", updated_at: "2026-09-05T14:00:00.000Z" }} {...sharedProps} />);
    await waitFor(() => expect(screen.getByText("Responsable actual:").parentElement).toHaveTextContent("Caja Dos"));

    rerender(<SemiAdminOperationalPanel order={{ ...externalQuoteOrder, quote_id: "semi-1", updated_at: "2026-09-05T14:01:00.000Z" }} {...sharedProps} />);
    await waitFor(() => expect(screen.getByText("Responsable actual:").parentElement).toHaveTextContent("Yo"));
  });

  it("marks Production as read-only without hiding the authorized Caja handoff", async () => {
    renderPanel({ ...order, status: "in_Production" }, { onLoadCatalog: vi.fn().mockResolvedValue({ actions: [], unavailable_actions: [] }) });

    await waitFor(() => expect(screen.getByText("Etapa de solo lectura")).toBeVisible());
    expect(screen.getByText(/corresponden exclusivamente al operador de Producción asignado/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Preparar envío a Producción/i })).not.toBeInTheDocument();
  });
});
