import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentBadge } from "../components/ui/Badge";
import { PAYMENT_STATUS } from "../utils/constants";

const quote = readFileSync(join(cwd(), "src/pages/page-quote.jsx"), "utf8");

describe("etiquetas de pago y sincronización de detalle en Caja", () => {
  it("mantiene la etiqueta global y acepta una variante compacta explícita", () => {
    const { rerender } = render(<PaymentBadge status={PAYMENT_STATUS.PENDING} />);
    expect(screen.getByText("Pago Pendiente")).toBeInTheDocument();

    rerender(<PaymentBadge status={PAYMENT_STATUS.PENDING} labelOverride="Pendiente" />);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();

    rerender(<PaymentBadge status={PAYMENT_STATUS.PARTIAL} labelOverride="Parcial" />);
    expect(screen.getByText("Parcial")).toBeInTheDocument();
  });

  it("confina las etiquetas compactas a las tres representaciones de listado", () => {
    const compactBadge = 'labelOverride={CASHIER_PAYMENT_LABEL_OVERRIDES[order.payment_status]}';
    expect(quote.split(compactBadge)).toHaveLength(4);
    expect(quote).toContain('<PaymentBadge status={order.payment_status} className="pq-badge" />');
  });

  it("hidrata y combina la orden pagada antes de actualizar el detalle anidado", () => {
    const start = quote.indexOf("const handleConfirmPayment = async");
    const end = quote.indexOf("const handleAssignInvoiceCode", start);
    const handler = quote.slice(start, end);

    expect(handler).toContain("const hydratedOrder = await fetchOrderWithProductionFiles(updatedOrder.id);");
    expect(handler).toContain("const nextOrder = mergeOrderWithProductionFiles(order, hydratedOrder || updatedOrder);");
    expect(handler).toContain("mergeOrderWithProductionFiles(previous, nextOrder)");
    expect(handler).toContain("return { ok: true, order: nextOrder };");
    expect(handler.indexOf("if (updateError || !updatedOrder)")).toBeLessThan(handler.indexOf("fetchOrderWithProductionFiles(updatedOrder.id)"));
  });
});
