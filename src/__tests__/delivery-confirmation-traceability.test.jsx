import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const deliveryPage = read("src/pages/page-delivery.jsx");
const sharedDetail = read("src/components/orders/OrderDetailModal.jsx");
const dashboard = read("src/pages/dashboard.jsx");

describe("delivery confirmation UI contracts", () => {
  it("routes every delivery through the required executor form and new RPC signature", () => {
    expect(deliveryPage).toContain('id="delivery-confirmation-title">Registro de entrega');
    expect(deliveryPage).toContain("Yo, responsable asignado");
    expect(deliveryPage).toContain("Otra persona");
    expect(deliveryPage).toContain('id="delivery-other-executor"');
    expect(deliveryPage).toContain("p_executor_type: executorType");
    expect(deliveryPage).toContain("p_other_executor_name:");
    expect(deliveryPage).toContain("p_delivery_comment:");
    expect(deliveryPage).toContain("Indica el nombre de la otra persona");
    expect(deliveryPage).toContain("otherExecutorInputRef.current?.focus()");
    expect(deliveryPage).toContain("ref={otherExecutorInputRef}");
    expect(deliveryPage).not.toContain('from("order_events").insert');
  });

  it("opens the form from the card without marking an order delivered", () => {
    const quickHandler = deliveryPage.slice(
      deliveryPage.indexOf("const handleOpenDeliveryForm"),
      deliveryPage.indexOf("const handleArchiveOrder"),
    );
    expect(quickHandler).toContain("setSelectedOrder(order || null)");
    expect(quickHandler).not.toContain('rpc("delivery_mark_order_delivered"');
    expect(deliveryPage).toContain('title={deliverBlocked ? PAYMENT_DELIVERY_BLOCKED_MESSAGE : "Registrar entrega"}');
  });

  it("uses the private relation for Delivery and displays structured or legacy data", () => {
    expect(deliveryPage).toContain("DELIVERY_ORDER_SELECT");
    expect(deliveryPage).toContain("getDeliveryConfirmation(order)");
    expect(deliveryPage).toContain("Comentario de entrega (registro histórico)");
    expect(deliveryPage).toContain("setExecutorType(confirmation?.executor_type || \"assigned_delivery\")");
  });

  it("exposes confirmation details only through the explicit admin capability", () => {
    expect(sharedDetail).toContain("showDeliveryConfirmation = false");
    expect(sharedDetail).toContain('from("delivery_confirmations")');
    expect(sharedDetail).toContain("Confirmación de entrega");
    expect(sharedDetail).toContain("deliveryConfirmationLoading");
    expect(sharedDetail).toContain("deliveryConfirmationError");
    expect(sharedDetail).toContain("Cargando confirmación de entrega");
    expect(sharedDetail).toContain("Reintentar");
    expect(dashboard).toContain("showDeliveryConfirmation");
  });
});
