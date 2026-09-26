import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowTrackClient } from "../components/FlowTrackClient";
import { ORDER_STATUS, PAYMENT_STATUS, PRODUCTION_FILE_STATUS } from "../utils/constants";

const baseOrder = {
  id: "12345678-1234-1234-1234-123456789abc",
  status: ORDER_STATUS.IN_PRODUCTION,
  payment_status: PAYMENT_STATUS.PAID,
  client_name: "Cliente Demo",
  order_design_type: "INTERNAL_DESING",
};

const defaultLabels = [
  "Banner principal",
  "Camisetas DTF",
  "Letrero terminado",
  "Vinilo lateral",
];

const makeTrackingPart = (fileIndex, areaLabel, status, displayLabel = defaultLabels[fileIndex - 1]) => ({
  file_index: fileIndex,
  display_label: displayLabel,
  production_area_code: areaLabel.toLowerCase(),
  production_area_label: areaLabel,
  status,
  updated_at: "2026-06-17T12:00:00.000Z",
  completed_at: status === PRODUCTION_FILE_STATUS.COMPLETED ? "2026-06-17T13:00:00.000Z" : null,
});

const renderFlowTrack = (props = {}) => render(
  <FlowTrackClient
    status={props.status || baseOrder.status}
    events={props.events || []}
    order={{ ...baseOrder, ...props.order }}
    designType={props.designType || baseOrder.order_design_type}
    productionFiles={props.productionFiles}
  />
);

describe("FlowTrackClient order part subphases", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders sanitized public part names in the matching visual subphase", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_PRODUCTION,
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.IN_PRODUCTION),
        makeTrackingPart(2, "DTF", PRODUCTION_FILE_STATUS.IN_TERMINATION),
        makeTrackingPart(3, "Ploteo", PRODUCTION_FILE_STATUS.COMPLETED),
      ],
    });

    expect(screen.getAllByText("Banner principal")).toHaveLength(2);
    expect(screen.getAllByText("Camisetas DTF")).toHaveLength(2);
    expect(screen.getAllByText("Letrero terminado")).toHaveLength(2);
    expect(screen.queryByText("Archivo 1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Digital")).toHaveLength(2);
    expect(screen.getAllByText("En produccion")).toHaveLength(2);
    expect(screen.getAllByText("En terminacion")).toHaveLength(2);
    expect(screen.getAllByText("Completado")).toHaveLength(2);

    expect(document.querySelectorAll(".ftc-file-chip.production")).toHaveLength(2);
    expect(document.querySelectorAll(".ftc-file-chip.termination")).toHaveLength(2);
    expect(document.querySelectorAll(".ftc-file-chip.completed")).toHaveLength(2);
  });

  it("keeps pending parts visible as not started without advancing later order steps", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_PRODUCTION,
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.PENDING),
      ],
    });

    expect(screen.getAllByText("Banner principal")).toHaveLength(2);
    expect(screen.getAllByText("Por iniciar")).toHaveLength(2);
    expect(document.querySelectorAll(".ftc-file-chip.pending")).toHaveLength(2);

    const terminationStep = Array.from(document.querySelectorAll(".ftc-h-step"))
      .find((step) => step.textContent.includes("Terminaci"));

    expect(terminationStep).toBeTruthy();
    expect(terminationStep).not.toHaveClass("active");
    expect(terminationStep).not.toHaveClass("completed");
  });

  it("uses the public legacy fallback instead of technical file copy", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_PRODUCTION,
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.IN_PRODUCTION, "Parte 1 del pedido"),
      ],
    });

    expect(screen.getAllByText("Parte 1 del pedido")).toHaveLength(2);
    expect(screen.queryByText("Archivo 1")).not.toBeInTheDocument();
  });

  it("renders the scalable desktop band without the old absolute chip container", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_PRODUCTION,
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.PENDING),
        makeTrackingPart(2, "DTF", PRODUCTION_FILE_STATUS.IN_PRODUCTION),
        makeTrackingPart(3, "Ploteo", PRODUCTION_FILE_STATUS.IN_TERMINATION),
        makeTrackingPart(4, "Digital", PRODUCTION_FILE_STATUS.COMPLETED),
      ],
    });

    expect(document.querySelector(".ftc-part-band")).toBeInTheDocument();
    expect(document.querySelectorAll(".ftc-part-column")).toHaveLength(3);
    expect(document.querySelector(".ftc-h-files")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Partes del pedido por fase")).toBeInTheDocument();
  });

  it("falls back to the original timeline when no production parts are provided", () => {
    renderFlowTrack({ productionFiles: [] });

    expect(screen.getAllByText("Producción").length).toBeGreaterThan(0);
    expect(document.querySelector(".ftc-file-chip")).not.toBeInTheDocument();
    expect(document.querySelector(".ftc-part-band")).not.toBeInTheDocument();
  });

  it("does not render production part chips for cancelled orders", () => {
    renderFlowTrack({
      status: ORDER_STATUS.CANCELLED,
      order: {
        status: ORDER_STATUS.CANCELLED,
        cancellation_reason: "Cancelada por solicitud del cliente",
      },
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.COMPLETED),
      ],
    });

    expect(screen.getByText("Orden cancelada")).toBeInTheDocument();
    expect(screen.getByText("Cancelada por solicitud del cliente")).toBeInTheDocument();
    expect(document.querySelector(".ftc-file-chip")).not.toBeInTheDocument();
  });

  it("preserves the pending-payment quote state", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_QUOTE,
      order: {
        status: ORDER_STATUS.IN_QUOTE,
        payment_status: PAYMENT_STATUS.PENDING,
      },
      productionFiles: [],
    });

    expect(screen.getAllByText("Pago pendiente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("El proceso continuará cuando el pago sea confirmado").length).toBeGreaterThan(0);
    expect(document.querySelector(".ftc-file-chip")).not.toBeInTheDocument();
  });

  it("shows partial payment without blocking production progress", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_COMPLETED,
      order: {
        status: ORDER_STATUS.IN_COMPLETED,
        payment_status: PAYMENT_STATUS.PARTIAL,
      },
      productionFiles: [
        makeTrackingPart(1, "Digital", PRODUCTION_FILE_STATUS.COMPLETED),
      ],
    });

    expect(screen.getAllByText("Pago parcial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No se puede entregar la orden hasta que esté totalmente pagada.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pago confirmado")).not.toBeInTheDocument();
    expect(screen.queryByText("El proceso continuará cuando el pago sea confirmado")).not.toBeInTheDocument();
    expect(screen.getAllByText("Banner principal")).toHaveLength(2);
  });

  it("shows credit payment as operational progress with pending debt", () => {
    renderFlowTrack({
      status: ORDER_STATUS.IN_DELIVERED,
      order: {
        status: ORDER_STATUS.IN_DELIVERED,
        payment_status: PAYMENT_STATUS.CREDIT,
      },
      productionFiles: [],
    });

    expect(screen.getAllByText("Pago a crédito").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pago confirmado")).not.toBeInTheDocument();
    expect(screen.queryByText("Pago pendiente")).not.toBeInTheDocument();
    expect(screen.queryByText("El proceso continuarÃ¡ cuando el pago sea confirmado")).not.toBeInTheDocument();
  });
});
