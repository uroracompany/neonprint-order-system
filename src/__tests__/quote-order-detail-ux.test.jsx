/* global process */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteOrderDetailModal } from "../pages/page-quote";
import { clearSecureUrlCache } from "../hooks/useSecureFileUrl";
import { getPaymentStatusLabel, PAYMENT_COLORS, PAYMENT_STATUS } from "../utils/constants";

const fileAccessMocks = vi.hoisted(() => ({
  resolveOrderAssetUrl: vi.fn(),
  openOrderAssetUrl: vi.fn(),
}));

const uploadAssetMocks = vi.hoisted(() => ({
  createSignedOrderAssetUrlFromStoredUrl: vi.fn(),
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl: fileAccessMocks.resolveOrderAssetUrl,
  openOrderAssetUrl: fileAccessMocks.openOrderAssetUrl,
  requiresOrderAssetGateway: (url) => String(url || "").startsWith("supabase://") || String(url || "").startsWith("r2://"),
}));

vi.mock("../utils/uploadOrderAsset", async (importOriginal) => ({
  ...await importOriginal(),
  createSignedOrderAssetUrlFromStoredUrl: uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl,
}));

const baseOrder = {
  id: "00000000-0000-0000-0000-000000000001",
  created_at: "2026-10-20T12:00:00.000Z",
  status: "in_Quote",
  payment_status: "Pending_Payment",
  order_design_type: "EXTERNAL_DESING",
  client_name: "Cliente de prueba",
  order_file_url: JSON.stringify(["supabase://order-docs/orders/file-cliente.pdf"]),
  reference_images: ["supabase://order-previews/orders/referencia.webp"],
  preview_image: "supabase://order-previews/orders/orden-trabajo.webp",
  order_production_files: [{
    id: "production-file-1",
    url: "supabase://order-docs/orders/produccion.pdf",
    production_area_code: "digital",
    material_names: ["Vinil"],
    termination_name: "Corte",
  }],
};

const renderDetail = (orderOverrides = {}, props = {}) => render(
  <QuoteOrderDetailModal
    open
    onClose={vi.fn()}
    order={{ ...baseOrder, ...orderOverrides }}
    onOpenPayment={vi.fn()}
    onOpenReturnModal={vi.fn()}
    {...props}
  />,
);

const normalizeCssColor = (color) => {
  const hex = String(color || "").match(/^#([\da-f]{6})$/i);
  if (!hex) return String(color || "").toLowerCase();

  const channels = hex[1].match(/[\da-f]{2}/gi).map((channel) => Number.parseInt(channel, 16));
  return `rgb(${channels.join(", ")})`;
};
const quoteCss = readFileSync(resolve(process.cwd(), "src/css-components/page-quote.css"), "utf8");

describe("experiencia del detalle de Caja", () => {
  beforeEach(() => {
    clearSecureUrlCache();
    fileAccessMocks.resolveOrderAssetUrl.mockReset();
    fileAccessMocks.openOrderAssetUrl.mockReset().mockResolvedValue(undefined);
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockReset();
  });

  it.each([
    [PAYMENT_STATUS.PENDING],
    [PAYMENT_STATUS.PAID],
    [PAYMENT_STATUS.PARTIAL],
    [PAYMENT_STATUS.CREDIT],
  ])("muestra etiqueta, icono y colores semánticos del estado %s", (status) => {
    renderDetail({ payment_status: status });

    const summary = document.querySelector(".pq-payment-summary");
    const statusGroup = summary.querySelector(".pq-payment-summary-status");
    const badge = statusGroup.querySelector(".pq-badge");
    const css = quoteCss;
    const expected = PAYMENT_COLORS[status];

    expect(statusGroup).toHaveTextContent("Estado actual");
    expect(statusGroup.querySelector(".pq-payment-summary-status-icon")).toHaveAttribute("data-payment-status-icon", status);
    expect(css).toMatch(/\.pq-payment-summary-label\s*\{[^}]*color:\s*#1e40af/i);
    expect(badge).toHaveTextContent(getPaymentStatusLabel(status));
    expect(badge.style.background).toBe(normalizeCssColor(expected.bg));
    expect(badge.style.color).toBe(normalizeCssColor(expected.color));
    expect(statusGroup.querySelector(".pq-badge-dot").style.background).toBe(normalizeCssColor(expected.dot));
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["   "],
  ])("muestra ‘Sin registrar’ si el código de facturación está ausente (%s)", (invoiceNumber) => {
    renderDetail({ invoice_number: invoiceNumber });

    expect(document.querySelector(".pq-payment-summary-invoice")).toHaveTextContent("Código de facturación");
    expect(document.querySelector(".pq-payment-summary-invoice strong")).toHaveTextContent("Sin registrar");
    expect(document.querySelector(".pq-payment-summary-invoice-code")).not.toBeInTheDocument();
  });

  it("muestra estado y código bajo Descripción en Información de la orden, no en Comprobante de pago", () => {
    renderDetail({ invoice_number: "FAC-3393993" });

    const infoPanel = document.querySelector(".pq-info-panel");
    const paymentPanel = document.querySelector(".pq-payment-panel");
    const description = within(infoPanel).getByText("Descripción").closest(".pq-description-box");
    const summary = within(infoPanel).getByText("Estado actual").closest(".pq-payment-summary");

    expect(summary).toBeInTheDocument();
    expect(description.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(summary).getByText("Estado actual")).toBeInTheDocument();
    expect(within(summary).getByText("Código de facturación")).toBeInTheDocument();
    expect(within(summary).getByText("FAC-3393993")).toBeInTheDocument();
    expect(within(summary).getByText("FAC-3393993")).toHaveClass("pq-payment-summary-invoice-code");
    expect(within(paymentPanel).queryByText("Estado actual")).not.toBeInTheDocument();
    expect(within(paymentPanel).queryByText("Código de facturación")).not.toBeInTheDocument();
    expect(within(paymentPanel).getByText("Comprobante de pago")).toHaveClass("pq-panel-title");
  });

  it("mantiene Descripción sobria y separa el resumen de pago con el espaciado acordado", () => {
    const css = quoteCss;
    const descriptionRule = css.match(/\.pq-description-box\s*\{([^}]*)\}/s)?.[1] || "";
    const summaryRule = css.match(/\.pq-payment-summary\s*\{([^}]*)\}/s)?.[1] || "";
    const summaryLabelRule = css.match(/\.pq-payment-summary-label\s*\{([^}]*)\}/s)?.[1] || "";
    const invoiceChipRule = css.match(/\.pq-payment-summary-invoice \.pq-payment-summary-invoice-code\s*\{([^}]*)\}/s)?.[1] || "";

    expect(descriptionRule).toMatch(/border:\s*1px solid var\(--pq-border\)/);
    expect(descriptionRule).not.toMatch(/border:\s*[^;]*dashed/i);
    expect(descriptionRule).toMatch(/border-radius:\s*var\(--pq-radius-md\)/);
    expect(descriptionRule).toMatch(/background:\s*var\(--pq-surface-alt,\s*#F5F7FB\)/i);
    expect(summaryRule).toMatch(/margin-top:\s*16px/);
    expect(summaryLabelRule).toMatch(/color:\s*#1e40af/i);
    expect(invoiceChipRule).toMatch(/background:\s*#dbeafe/i);
    expect(invoiceChipRule).toMatch(/border-radius:\s*6px/i);
  });

  it("apila estado y código en ese orden y conserva el valor", () => {
    renderDetail({ invoice_number: "  FAC-3393993  " });

    const summary = document.querySelector(".pq-payment-summary");
    const statusGroup = summary.querySelector(".pq-payment-summary-status");
    const invoiceGroup = summary.querySelector(".pq-payment-summary-invoice");
    expect(statusGroup.compareDocumentPosition(invoiceGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(invoiceGroup.querySelector("strong")).toHaveTextContent("FAC-3393993");

    const css = quoteCss;
    expect(css).toMatch(/\.pq-payment-summary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.pq-payment-summary-group\s*\+\s*\.pq-payment-summary-group\s*\{[^}]*border-top:\s*1px solid var\(--pq-border\)[^}]*border-left:\s*0/s);
    expect(css).toMatch(/\.pq-payment-summary-group\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.pq-payment-summary-invoice strong\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("usa un badge neutral para estados desconocidos sin tratarlos como pendientes", () => {
    renderDetail({ payment_status: "status_future" });

    const statusGroup = document.querySelector(".pq-payment-summary-status");
    expect(statusGroup.querySelector(".pq-payment-summary-badge--neutral")).toHaveTextContent("Estado de pago no disponible");
    expect(statusGroup.querySelector(".pq-badge")).not.toBeInTheDocument();
    expect(statusGroup.querySelector(".pq-payment-summary-status-icon")).not.toBeInTheDocument();
  });

  it("presenta el panel del comprobante con guía neutral y conserva la vista previa confirmada", async () => {
    const { unmount } = renderDetail();
    const paymentPanel = document.querySelector(".pq-payment-panel");
    expect(within(paymentPanel).getByText("Comprobante de pago")).toHaveClass("pq-panel-title");
    expect(screen.getByText("El comprobante confirmado se muestra aquí después de registrar el pago.")).toBeInTheDocument();
    unmount();

    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockResolvedValue("https://signed.example.com/payment-receipt.png");
    renderDetail({ payment_status: PAYMENT_STATUS.PAID, invoice_payment: "supabase://payment-invoice/orders/payment-receipt.png" });

    const receipt = await screen.findByAltText("Comprobante de pago");
    expect(receipt).toHaveAttribute("src", "https://signed.example.com/payment-receipt.png");
    expect(document.querySelector(".pq-payment-panel")).toContainElement(receipt);
    const fullViewLink = within(document.querySelector(".pq-preview-block")).getByRole("link", { name: "Ver completo" });
    expect(fullViewLink).toHaveAttribute("href", "https://signed.example.com/payment-receipt.png");
    expect(fullViewLink).toHaveAttribute("target", "_blank");
    expect(fullViewLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(fullViewLink.getAttribute("href")).not.toContain("supabase://");
    expect(within(document.querySelector(".pq-payment-panel")).getAllByText("Comprobante de pago")).toHaveLength(1);
    expect(receipt).toHaveAttribute("alt", "Comprobante de pago");
    expect(screen.queryByText("El comprobante confirmado se muestra aquí después de registrar el pago.")).not.toBeInTheDocument();
  });

  it("explica la carga, referencia ausente y fallo recuperable del comprobante pagado", async () => {
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = renderDetail({ payment_status: PAYMENT_STATUS.PAID, invoice_payment: "supabase://payment-invoice/orders/payment-receipt.png" });
    expect(document.querySelector(".pq-receipt-state")).toHaveTextContent("Cargando comprobante de pago");

    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={{ ...baseOrder, payment_status: PAYMENT_STATUS.PAID }} />);
    expect(document.querySelector(".pq-receipt-state")).toHaveTextContent("No hay un comprobante disponible para esta orden");
    expect(screen.queryByAltText("Comprobante de pago")).not.toBeInTheDocument();

    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockRejectedValueOnce(new Error("gateway unavailable"));
    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={{ ...baseOrder, payment_status: PAYMENT_STATUS.PAID, invoice_payment: "supabase://payment-invoice/orders/payment-receipt.png" }} />);
    const receiptError = await screen.findByText("No se pudo cargar el comprobante de pago.");
    expect(receiptError.closest('[role="alert"]')).toHaveClass("pq-receipt-error");
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockResolvedValueOnce("https://signed.example.com/retried-receipt.png");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByAltText("Comprobante de pago")).toHaveAttribute("src", "https://signed.example.com/retried-receipt.png");
  });

  it("presenta la guía del comprobante con una superficie informativa neutral", () => {
    const css = quoteCss;
    const hintRule = css.match(/\.pq-upload-hint\s*\{([^}]*)\}/s)?.[1] || "";

    expect(hintRule).toMatch(/border:\s*1px solid var\(--pq-border\)/);
    expect(hintRule).toMatch(/background:\s*var\(--pq-surface-alt,/);
    expect(hintRule).toMatch(/color:\s*var\(--pq-text-sub,/);
    expect(hintRule).not.toMatch(/#fde68a|#fffbeb|#c2410c/i);
  });

  it("abre el comprobante firmado desde las acciones y lo conserva como única acción", async () => {
    const signedReceiptUrl = "https://signed.example.com/payment-receipt.png?token=test-token";
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockResolvedValue(signedReceiptUrl);
    const paidOrder = {
      ...baseOrder,
      status: "in_Completed",
      payment_status: PAYMENT_STATUS.PAID,
      invoice_payment: "supabase://payment-invoice/orders/private-receipt.png",
    };

    renderDetail(paidOrder);

    const receiptLink = await screen.findByRole("link", { name: "Ver comprobante de facturación" });
    const actions = screen.getByRole("group", { name: "Acciones de la orden" });
    expect(actions).toContainElement(receiptLink);
    expect(receiptLink).toHaveAttribute("href", signedReceiptUrl);
    expect(receiptLink).toHaveAttribute("target", "_blank");
    expect(receiptLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(receiptLink.getAttribute("href")).not.toContain("supabase://");
    expect(within(actions).queryByRole("button", { name: "Gestionar pago" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: /Devolver al/ })).not.toBeInTheDocument();
  });

  it.each([
    ["sin referencia", undefined, "https://signed.example.com/unused.png"],
    ["sin URL resuelta", "supabase://payment-invoice/orders/payment-receipt.png", ""],
  ])("no ofrece el enlace al comprobante cuando está %s", async (_description, invoicePayment, resolvedUrl) => {
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockResolvedValue(resolvedUrl);
    renderDetail({
      ...baseOrder,
      status: "in_Completed",
      payment_status: PAYMENT_STATUS.PAID,
      invoice_payment: invoicePayment,
    });

    await waitFor(() => expect(document.querySelector(".pq-receipt-state")).toHaveTextContent("No hay un comprobante disponible para esta orden"));
    expect(screen.queryByRole("link", { name: "Ver comprobante de facturación" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver completo" })).not.toBeInTheDocument();
    expect(screen.queryByAltText("Comprobante de pago")).not.toBeInTheDocument();
  });

  it("mantiene el enlace asociado a la orden actual mientras resuelve un segundo comprobante", async () => {
    const firstUrl = "https://signed.example.com/first-receipt.png";
    const secondUrl = "https://signed.example.com/second-receipt.png";
    let resolveSecondReceipt;
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockImplementation(({ url }) => (
      url.includes("first-receipt")
        ? Promise.resolve(firstUrl)
        : new Promise((resolve) => { resolveSecondReceipt = resolve; })
    ));
    const firstOrder = {
      ...baseOrder,
      status: "in_Completed",
      payment_status: PAYMENT_STATUS.PAID,
      invoice_payment: "supabase://payment-invoice/orders/first-receipt.png",
    };
    const { rerender } = renderDetail(firstOrder);

    expect(await screen.findByRole("link", { name: "Ver comprobante de facturación" })).toHaveAttribute("href", firstUrl);

    const secondOrder = {
      ...firstOrder,
      id: "00000000-0000-0000-0000-000000000002",
      invoice_payment: "supabase://payment-invoice/orders/second-receipt.png",
    };
    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={secondOrder} />);

    expect(screen.queryByRole("link", { name: "Ver comprobante de facturación" })).not.toBeInTheDocument();
    resolveSecondReceipt(secondUrl);
    expect(await screen.findByRole("link", { name: "Ver comprobante de facturación" })).toHaveAttribute("href", secondUrl);
  });

  it("descarta una URL de comprobante tardía tras cambiar de orden o dejar el estado pagado", async () => {
    let resolveFirst;
    uploadAssetMocks.createSignedOrderAssetUrlFromStoredUrl.mockImplementation(({ url }) => (
      url.includes("first")
        ? new Promise((resolve) => { resolveFirst = resolve; })
        : Promise.resolve("https://signed.example.com/current.png")
    ));
    const firstOrder = {
      ...baseOrder,
      payment_status: PAYMENT_STATUS.PAID,
      invoice_payment: "supabase://payment-invoice/orders/first.png",
    };
    const { rerender } = renderDetail(firstOrder);
    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={{
      ...firstOrder,
      id: "00000000-0000-0000-0000-000000000002",
      invoice_payment: "supabase://payment-invoice/orders/current.png",
    }} />);

    expect(await screen.findByAltText("Comprobante de pago")).toHaveAttribute("src", "https://signed.example.com/current.png");
    await act(async () => resolveFirst("https://signed.example.com/stale.png"));
    expect(screen.getByAltText("Comprobante de pago")).toHaveAttribute("src", "https://signed.example.com/current.png");

    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={{ ...baseOrder, payment_status: PAYMENT_STATUS.PENDING }} />);
    expect(screen.queryByAltText("Comprobante de pago")).not.toBeInTheDocument();
    expect(screen.getByText("El comprobante confirmado se muestra aquí después de registrar el pago.")).toBeInTheDocument();
  });

  it("mantiene header y footer visibles con cuerpo desplazable y esquinas uniformes", () => {
    renderDetail();
    const modal = document.querySelector(".pq-overlay > .pq-modal");
    const body = modal.querySelector(":scope > .pq-modal-body");
    const footer = modal.querySelector(":scope > .pq-modal-footer");
    expect(body.nextElementSibling).toBe(footer);
    expect(footer).toHaveTextContent("Cerrar");

    const css = quoteCss;

    expect(css).toMatch(/\.pq-modal\s*,\s*\.pq-dialog\s*\{[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.pq-overlay > \.pq-modal\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.pq-overlay > \.pq-modal > \.pq-modal-body\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.pq-overlay > \.pq-modal > \.pq-modal-body > \*\s*\{[^}]*flex-shrink:\s*0/s);
    expect(css).toMatch(/\.pq-modal-footer\s*\{[^}]*border-top:\s*1px solid var\(--pq-border\);[^}]*background:\s*#ffffff/s);
    expect(css).toMatch(/\.pq-modal-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*\d+;[^}]*background:\s*#ffffff/s);
    expect(css).toMatch(/\.pq-modal\s*,\s*\.pq-dialog\s*\{[^}]*border-radius:\s*28px/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.pq-modal\s*\{[^}]*border-radius:\s*24px/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.pq-flow-actions\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.pq-flow-actions \.pq-btn\s*\{[^}]*flex:\s*1 1 auto/s);
  });

  it("oculta adjuntos y referencias, conserva clasificación y muestra la vista previa segura", async () => {
    fileAccessMocks.resolveOrderAssetUrl.mockResolvedValue("https://signed.example.com/orden-trabajo.webp");
    renderDetail({
      order_production_files: [
        baseOrder.order_production_files[0],
        { ...baseOrder.order_production_files[0], id: "production-file-2", production_area_code: null },
      ],
    });

    expect(screen.queryByText("Archivos Adjuntos")).not.toBeInTheDocument();
    expect(screen.queryByText("file-cliente.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("Imágenes de referencia")).not.toBeInTheDocument();
    expect(screen.getByText("Clasificación de producción")).toBeInTheDocument();
    expect(screen.queryByText(/archivos clasificados/)).not.toBeInTheDocument();

    const visualColumn = document.querySelector(".pq-detail-visual-column");
    const previewCard = visualColumn.querySelector(".pq-detail-preview-card");
    const productionCard = visualColumn.querySelector(".pq-detail-production-card");
    expect(previewCard.parentElement).toBe(visualColumn);
    expect(productionCard.parentElement).toBe(visualColumn);
    expect(previewCard.compareDocumentPosition(productionCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const css = quoteCss;
    expect(css).toMatch(/\.pq-detail-grid\s*\.pq-detail-production-card\s*\{[^}]*background:\s*var\(--pq-surface,\s*#ffffff\)/s);

    const digitalRow = screen.getByText("Producción digital").closest(".pq-production-area-row");
    const dtfRow = screen.getByText("Producción DTF").closest(".pq-production-area-row");
    const ploteoRow = screen.getByText("Producción ploteo").closest(".pq-production-area-row");
    const pendingRow = screen.getByText("Pendientes").closest(".pq-production-area-row");
    expect(within(digitalRow).getByText("1 archivo")).toBeInTheDocument();
    expect(within(digitalRow).getByText("50%")).toBeInTheDocument();
    expect(within(dtfRow).getByText("0 archivos")).toBeInTheDocument();
    expect(within(dtfRow).getByText("0%")).toBeInTheDocument();
    expect(within(ploteoRow).getByText("0 archivos")).toBeInTheDocument();
    expect(within(ploteoRow).getByText("0%")).toBeInTheDocument();
    expect(within(pendingRow).getByText("1 archivo")).toBeInTheDocument();
    expect(within(pendingRow).getByText("50%")).toBeInTheDocument();
    expect(css).toMatch(/\.pq-production-area-row\s*\{[^}]*border:\s*1px solid var\(--pq-border\)/s);
    expect(document.querySelector(".pq-production-area-bar")).not.toBeInTheDocument();
    expect(document.querySelector(".pq-production-area-bar-fill")).not.toBeInTheDocument();

    const preview = await screen.findByAltText("Imagen de orden de trabajo");
    expect(preview).toHaveAttribute("src", "https://signed.example.com/orden-trabajo.webp");
    fireEvent.load(preview);

    const imageLink = preview.closest("a");
    const fullViewButton = await screen.findByRole("button", { name: "Ver completo" });
    expect(imageLink).toContainElement(preview);
    expect(imageLink).not.toContainElement(fullViewButton);
    expect(fullViewButton.closest("a")).toBeNull();
    expect(fullViewButton.parentElement).toHaveClass("pq-work-preview-actions");
    expect(imageLink.parentElement).toContainElement(fullViewButton);

    await userEvent.setup().click(fullViewButton);
    expect(fileAccessMocks.openOrderAssetUrl).toHaveBeenCalledOnce();
    expect(fileAccessMocks.openOrderAssetUrl).toHaveBeenCalledWith({
      url: baseOrder.preview_image,
      fileName: "orden-trabajo.webp",
      download: false,
    });
  });

  it("muestra estados de carga, error y ausencia de imagen", async () => {
    let resolveAsset;
    fileAccessMocks.resolveOrderAssetUrl.mockImplementation(() => new Promise((resolve) => { resolveAsset = resolve; }));
    const { unmount } = renderDetail();
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver completo" })).not.toBeInTheDocument();
    resolveAsset("https://signed.example.com/orden-trabajo.webp");
    const resolvedPreview = await screen.findByAltText("Imagen de orden de trabajo");
    expect(screen.queryByRole("button", { name: "Ver completo" })).not.toBeInTheDocument();
    fireEvent.load(resolvedPreview);
    expect(await screen.findByRole("button", { name: "Ver completo" })).toBeInTheDocument();
    unmount();

    fileAccessMocks.resolveOrderAssetUrl.mockRejectedValueOnce(new Error("No se pudo resolver el archivo"));
    renderDetail({ preview_image: "supabase://order-previews/orders/orden-error.webp" });
    expect(await screen.findByText("No disponible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver completo" })).not.toBeInTheDocument();

    renderDetail({ preview_image: null });
    expect(screen.getByText("No hay imagen de orden de trabajo cargada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver completo" })).not.toBeInTheDocument();
  });

  it("oculta la fila Pendientes cuando todos los archivos tienen área", () => {
    renderDetail({ order_production_files: [baseOrder.order_production_files[0]] });

    expect(screen.queryByText(/archivos clasificados/)).not.toBeInTheDocument();
    expect(screen.queryByText("Pendientes")).not.toBeInTheDocument();
  });

  it("mantiene ausente la tarjeta de clasificación si no hay archivos de producción", () => {
    renderDetail({ order_production_files: [], order_file_url: null });

    expect(document.querySelector(".pq-detail-preview-card")).toBeInTheDocument();
    expect(document.querySelector(".pq-detail-production-card")).not.toBeInTheDocument();
  });

  it("mantiene dos columnas en escritorio y separa visualmente las tarjetas del detalle", () => {
    const css = quoteCss;

    expect(css).toMatch(/\.pq-detail-grid\s*,\s*\.pq-payment-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*\d+px\)[\s\S]*?\.pq-detail-grid\s*,\s*\.pq-payment-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/\.pq-detail-grid\s*\.pq-detail-visual-column\s*\{[^}]*display:\s*grid;[^}]*gap:\s*16px/s);
    expect(css).toMatch(/\.pq-detail-grid\s*\.pq-detail-preview-card\s*,\s*\.pq-detail-grid\s*\.pq-detail-production-card\s*\{[^}]*border:\s*1px solid var\(--pq-border\)[^}]*border-radius:\s*16px/s);
    expect(css).toMatch(/\.pq-detail-grid\s*\.pq-detail-production-card\s*\{[^}]*background:\s*var\(--pq-surface,\s*#ffffff\)/s);
  });

  it("ubica pago y devolución junto a los estados y conserva callbacks y etiqueta por flujo", async () => {
    const onOpenPayment = vi.fn();
    const onOpenReturnModal = vi.fn();
    renderDetail({}, { onOpenPayment, onOpenReturnModal });

    const summary = document.querySelector(".pq-flow-summary");
    const paymentButton = within(summary).getByRole("button", { name: "Gestionar pago" });
    const returnButton = within(summary).getByRole("button", { name: "Devolver al Vendedor" });
    expect(document.querySelector(".pq-payment-panel")).not.toContainElement(paymentButton);
    expect(document.querySelector(".pq-modal-actions")).not.toContainElement(returnButton);

    await userEvent.setup().click(paymentButton);
    await userEvent.setup().click(returnButton);
    expect(onOpenPayment).toHaveBeenCalledWith(baseOrder);
    expect(onOpenReturnModal).toHaveBeenCalledWith(baseOrder);
  });

  it("respeta las condiciones actuales y conserva la autorización de producción", async () => {
    const onAuthorizeProduction = vi.fn();
    const { rerender } = renderDetail({
      payment_status: "pagado",
      order_production_files: [{
        ...baseOrder.order_production_files[0],
        production_area_code: "digital",
        material_names: ["Vinil"],
        termination_name: "Corte",
      }],
    }, { onAuthorizeProduction });

    const productionButton = screen.getByRole("button", { name: "Autorizar para Producción" });
    expect(document.querySelector(".pq-payment-panel")).toContainElement(productionButton);
    expect(productionButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Gestionar pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Devolver al/ })).not.toBeInTheDocument();
    await userEvent.setup().click(productionButton);
    expect(onAuthorizeProduction).toHaveBeenCalledWith(expect.objectContaining({ id: baseOrder.id, payment_status: "pagado" }));

    rerender(<QuoteOrderDetailModal open onClose={vi.fn()} order={{ ...baseOrder, is_archived_quote: true }} />);
    expect(screen.queryByRole("button", { name: "Devolver al Vendedor" })).not.toBeInTheDocument();
  });

  it("muestra autorización deshabilitada y explica los datos de producción incompletos", () => {
    renderDetail({
      payment_status: PAYMENT_STATUS.PAID,
      order_production_files: [{
        ...baseOrder.order_production_files[0],
        production_area_code: null,
        material_names: [],
        termination_name: "",
      }],
    }, { onAuthorizeProduction: vi.fn() });

    expect(screen.getByRole("button", { name: "Autorizar para Producción" })).toBeDisabled();
    expect(document.querySelector(".pq-payment-authorization-blocker")).toHaveTextContent(/Completa el área, los materiales y la terminación/);
  });

  it("explica el pago no elegible solo cuando los archivos están listos", () => {
    renderDetail({ payment_status: PAYMENT_STATUS.PENDING }, { onAuthorizeProduction: vi.fn() });

    expect(screen.getByRole("button", { name: "Autorizar para Producción" })).toBeDisabled();
    expect(document.querySelector(".pq-payment-authorization-blocker")).toHaveTextContent("Para autorizar la producción, el pago debe estar Pagado, Parcial o Crédito.");
  });

  it.each([
    ["fuera de Caja", { status: "in_Production" }],
    ["ya autorizada", { production_authorized_at: "2026-10-21T12:00:00Z" }],
    ["archivada", { is_archived_quote: true }],
    ["bloqueada", { operational_status: "blocked" }],
  ])("no presenta autorización para una orden %s", (_label, orderOverrides) => {
    renderDetail({ payment_status: PAYMENT_STATUS.PAID, ...orderOverrides }, { onAuthorizeProduction: vi.fn() });
    expect(screen.queryByRole("button", { name: "Autorizar para Producción" })).not.toBeInTheDocument();
  });

  it("no presenta autorización cuando Caja no proporciona callback", () => {
    renderDetail({ payment_status: PAYMENT_STATUS.PAID });
    expect(screen.queryByRole("button", { name: "Autorizar para Producción" })).not.toBeInTheDocument();
  });
});
