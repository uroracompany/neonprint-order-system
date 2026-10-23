import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { OrderDetailModal } from "../pages/page-designer.jsx";
import { getOrderStatusConfig, ORDER_STATUS } from "../utils/constants";

const participationState = vi.hoisted(() => ({ timeline: [], loading: false, error: null }));

vi.mock("../hooks/useOrderParticipation", () => ({
  useOrderParticipation: () => participationState,
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl: vi.fn(async (url) => url),
  openOrderAssetUrl: vi.fn(),
  requiresOrderAssetGateway: () => false,
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => {
      const result = { data: [], error: null };
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        order: vi.fn(() => query),
        single: vi.fn(async () => ({ data: null, error: null })),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    }),
    rpc: vi.fn(),
  },
}));

const order = {
  id: "57aacf7a-0e05-4dd0-9f97-77911fd03bd9",
  status: ORDER_STATUS.IN_DESIGN,
  seller_id: "seller-1",
  client_name: "Cliente de prueba",
  description: "Orden de prueba",
  order_type: "normal",
  tracking_token: "tracking-token",
};
const testDirectory = dirname(fileURLToPath(import.meta.url));
const designerStyles = readFileSync(resolve(testDirectory, "../css-components/page-designer.css"), "utf8");

describe("Designer order tracker layout", () => {
  it.each([
    ["pending", { timeline: [], loading: true, error: null }],
    ["failed", { timeline: [], loading: false, error: "Historial no disponible" }],
  ])("renders the tracker on first paint while participation history is %s", (_state, state) => {
    Object.assign(participationState, state);

    render(
      <OrderDetailModal
        onClose={() => {}}
        order={order}
        designerFiles={[]}
        designerPreview={null}
        onRefresh={() => Promise.resolve()}
        onSendToQuotation={() => {}}
        quotationSending={false}
      />,
    );

    const progress = screen.getByRole("region", { name: "Progreso de la orden" });
    expect(within(progress).getByLabelText("Etapas de la orden")).toBeInTheDocument();
    expect(within(progress).getByText("Diseño")).toBeInTheDocument();
    expect(screen.queryByText("Cargando el flujo de la orden...")).not.toBeInTheDocument();
    if (state.loading) expect(screen.getByText("Cargando historial...")).toBeInTheDocument();
    if (state.error) expect(screen.getByRole("alert")).toHaveTextContent(state.error);
  });

  it("renders the tracker before the summary without a tracker heading", () => {
    Object.assign(participationState, { timeline: [], loading: false, error: null });
    render(
      <OrderDetailModal
        onClose={() => {}}
        order={order}
        designerFiles={[]}
        designerPreview={null}
        onRefresh={() => Promise.resolve()}
        onSendToQuotation={() => {}}
        quotationSending={false}
      />,
    );

    const progress = screen.getByRole("region", { name: "Progreso de la orden" });
    const summary = screen.getByLabelText("Resumen de la orden");
    const tracking = screen.getByRole("region", { name: "Enlace para el cliente" });

    expect(progress.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(progress).getByLabelText("Etapas de la orden")).toBeInTheDocument();
    expect(within(progress).getByText("Diseño")).toBeInTheDocument();
    expect(screen.queryByText("Seguimiento de la orden")).not.toBeInTheDocument();
    expect(tracking).toBeInTheDocument();
  });

  it("chooses the route synchronously from order fields and places the review after paired cards", () => {
    Object.assign(participationState, { timeline: [], loading: true, error: null });
    const directOrder = {
      ...order,
      seller_id: null,
      designer_id: "designer-1",
      created_by: "designer-1",
      order_design_type: "INTERNAL_DESING",
    };
    const { rerender } = render(
      <OrderDetailModal order={directOrder} designerFiles={[]} pendingReview={{ reviews: [] }} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />,
    );

    const progress = screen.getByRole("region", { name: "Progreso de la orden" });
    expect(within(progress).queryByText("Pendiente")).not.toBeInTheDocument();
    expect(within(progress).getByText("Diseño")).toBeInTheDocument();

    rerender(
      <OrderDetailModal order={{ ...order, seller_id: null, designer_id: null, created_by: null }} designerFiles={[]} pendingReview={{ reviews: [] }} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />,
    );
    expect(within(screen.getByRole("region", { name: "Progreso de la orden" })).getByText("Pendiente")).toBeInTheDocument();

    rerender(
      <OrderDetailModal order={{ ...order, order_design_type: "EXTERNAL_DESING" }} designerFiles={[]} pendingReview={{ reviews: [] }} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />,
    );
    expect(within(screen.getByRole("region", { name: "Progreso de la orden" })).queryByText("Diseño")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Progreso de la orden" })).getByText("Pendiente")).toBeInTheDocument();

    const infoGrid = document.querySelector(".designer-order-modal__content-grid");
    const review = document.querySelector(".designer-order-modal__body > .order-review-card");
    const workCard = within(infoGrid).getByText("Detalles de la orden de trabajo");
    expect(infoGrid).toContainElement(workCard);
    expect(infoGrid.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(infoGrid).getByText("Cliente")).toBeInTheDocument();
    expect(within(infoGrid).getByText("Descripción")).toBeInTheDocument();
  });

  it("keeps the tracker white and separates the tracking card using responsive gutters", () => {
    const trackerPanel = designerStyles.match(/\.designer-order-modal__flow \.ps-flow\s*\{([^}]*)\}/)?.[1] || "";
    const trackingSection = designerStyles.match(/\.designer-order-modal__tracking\s*\{([^}]*)\}/)?.[1] || "";

    expect(trackerPanel).toMatch(/background:\s*var\(--surface,\s*#fff\)/);
    expect(trackerPanel).toMatch(/min-width:\s*720px/);
    expect(trackingSection).toMatch(/margin:\s*18px var\(--designer-order-modal-section-gutter,\s*20px\) 18px/);
    expect(designerStyles).toMatch(/--designer-order-modal-section-gutter:\s*14px/);
  });

  it("matches Sales tracker geometry and uses responsive Sales-like information rows", () => {
    expect(designerStyles).toMatch(/\.designer-order-modal__flow \.ps-flow-circle\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*font-size:\s*12px;/s);
    expect(designerStyles).toMatch(/\.designer-order-modal__flow \.ps-flow-label\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*500;[^}]*line-height:\s*1\.2;/s);
    expect(designerStyles).toMatch(/\.designer-order-modal__content-grid\s*\{[^}]*minmax\(0, 1\.12fr\) minmax\(320px, 0\.88fr\)[^}]*gap:\s*16px;/s);
    expect(designerStyles).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{\s*\.designer-order-modal__content-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(designerStyles).toMatch(/\.designer-order-modal__info-row\s*\{[^}]*border-bottom:\s*1px solid/s);
  });

  it("labels the matching creation event as Designer only for designer-created orders", () => {
    Object.assign(participationState, {
      timeline: [
        { role: "seller", role_label: "Vendedor", user_name: "Luis Martínez", user_id: "designer-1", action: "Creó la orden", timestamp: "2026-10-18T23:30:00Z" },
        { role: "seller", role_label: "Vendedor", user_name: "Luis Martínez", user_id: "designer-1", action: "Actualizó la orden", timestamp: "2026-10-18T23:31:00Z" },
        { role: "seller", role_label: "Vendedor", user_name: "Usuario desconocido", action: "Creó la orden", timestamp: "2026-10-18T23:32:00Z" },
        { role: "seller", role_label: "Vendedor", user_name: "Vendedor distinto", user_id: "seller-1", action: "Creó la orden", timestamp: "2026-10-18T23:33:00Z" },
      ],
      loading: false,
      error: null,
    });
    const designerCreatedOrder = {
      ...order,
      seller_id: null,
      designer_id: "designer-1",
      created_by: "designer-1",
    };

    render(<OrderDetailModal order={designerCreatedOrder} designerFiles={[]} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />);

    const entries = document.querySelectorAll(".participation-entry");
    expect(within(entries[0]).getByText("Diseñador")).toBeInTheDocument();
    expect(within(entries[0]).getByText("Luis Martínez")).toBeInTheDocument();
    expect(entries[0].querySelector(".participation-icon").style.color).toBe("rgb(139, 92, 246)");
    expect(within(entries[1]).getByText("Vendedor")).toBeInTheDocument();
    expect(within(entries[1]).getByText("Actualizó la orden")).toBeInTheDocument();
    expect(within(entries[2]).getByText("Vendedor")).toBeInTheDocument();
    expect(within(entries[2]).getByText("Usuario desconocido")).toBeInTheDocument();
    expect(within(entries[3]).getByText("Vendedor")).toBeInTheDocument();
    expect(within(entries[3]).getByText("Vendedor distinto")).toBeInTheDocument();
  });

  it("preserves the Seller attribution for a seller-created order", () => {
    Object.assign(participationState, {
      timeline: [{ role: "seller", role_label: "Vendedor", user_name: "Luis Martínez", user_id: "seller-1", action: "Creó la orden", timestamp: "2026-10-18T23:30:00Z" }],
      loading: false,
      error: null,
    });

    render(<OrderDetailModal order={order} designerFiles={[]} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />);

    const creationEntry = document.querySelector(".participation-entry");
    expect(within(creationEntry).getByText("Vendedor")).toBeInTheDocument();
    expect(creationEntry.querySelector(".participation-icon").style.color).toBe("var(--pink)");
  });

  it.each([ORDER_STATUS.IN_DESIGN, ORDER_STATUS.CANCELLED])("shows the configured colored dot for status %s", (status) => {
    Object.assign(participationState, { timeline: [], loading: false, error: null });
    const expectedConfig = getOrderStatusConfig(status);
    const expectedDot = document.createElement("span");
    expectedDot.style.background = expectedConfig.dot;

    render(<OrderDetailModal order={{ ...order, status }} designerFiles={[]} onClose={() => {}} onRefresh={() => Promise.resolve()} onSendToQuotation={() => {}} />);

    const statusBadge = screen.getByLabelText("Resumen de la orden").querySelector(".designer-order-modal__summary-badge");
    const dot = statusBadge.querySelector(".designer-order-modal__summary-badge-dot");
    expect(statusBadge).toHaveTextContent(expectedConfig.label);
    expect(dot).toHaveStyle({ width: "5px", height: "5px", borderRadius: "50%", flex: "0 0 auto" });
    expect(dot.style.background).toBe(expectedDot.style.background);
    expect(designerStyles).toMatch(/\.designer-order-modal__summary-badge,\s*\.designer-order-modal__work-status\s*\{[^}]*gap:\s*5px;/s);
  });
});
