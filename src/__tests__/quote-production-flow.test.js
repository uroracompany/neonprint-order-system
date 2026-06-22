/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_STATUS,
  isPaymentDeliveryEligible,
  isPaymentProductionEligible,
} from "../utils/constants";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("flujo de produccion en caja", () => {
  it("permite pago parcial hacia produccion y mantiene bloqueo solo para entrega", () => {
    expect(isPaymentProductionEligible(PAYMENT_STATUS.PARTIAL)).toBe(true);
    expect(isPaymentDeliveryEligible(PAYMENT_STATUS.PARTIAL)).toBe(false);
  });

  it("actualiza la lista local y refresca silenciosamente al enviar a produccion", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const handlerStart = quote.indexOf("const handleConfirmSendToProduction = async");
    const handlerEnd = quote.indexOf("const handleConfirmArchive", handlerStart);
    const handler = quote.slice(handlerStart, handlerEnd);

    expect(handler).toContain('supabase');
    expect(handler).toContain('rpc("send_order_to_production"');
    expect(handler).toContain("const nextOrder = {");
    expect(handler).toContain("setOrders(prev => prev.map(item => item.id === nextOrder.id");
    expect(handler).toContain("setSelectedOrder(nextOrder)");
    expect(handler).toContain("setForwardToProductionOrder(null)");
    expect(handler).toContain("fetchOrdersRef.current(user.id, true)");
  });
});
