import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Caja payment management integration", () => {
  it("keeps the detail mounted while opening the payment modal in a nested layer", () => {
    const source = read("src/pages/page-quote.jsx");

    expect(source).toContain("const [paymentModalOrder, setPaymentModalOrder] = useState(null)");
    expect(source).toContain("nested={Boolean(selectedOrder && paymentModalOrder?.id === selectedOrder.id)}");
    expect(source).toContain("onOpenPayment={handleOpenPayment}");
    expect(source).toContain("onConfirm={handleConfirmPaymentFromModal}");
    expect(source).toContain("setPaymentModalOrder(null)");
  });

  it("hides row payment actions after either production authorization marker is set", () => {
    const source = read("src/pages/page-quote.jsx");
    const occurrences = source.match(/title="Gestionar pago"/g) || [];
    const guardedActions = source.match(
      /!order\.production_authorized_at && !order\.production_authorized_by && \(\s*<button className="(?:table-action-btn|card-action-btn) view"[\s\S]{0,300}?title="Gestionar pago"/g,
    ) || [];
    const tablePaymentActions = guardedActions.filter((action) => action.includes('className="table-action-btn view"'));
    const cardPaymentActions = guardedActions.filter((action) => action.includes('className="card-action-btn view"'));

    // The condition hides the row action when either persisted authorization field is populated.
    expect(occurrences).toHaveLength(3);
    expect(guardedActions).toHaveLength(3);
    expect(tablePaymentActions).toHaveLength(2);
    expect(cardPaymentActions).toHaveLength(1);
    expect(guardedActions.every((action) => action.includes("!order.production_authorized_at && !order.production_authorized_by"))).toBe(true);
    expect(guardedActions.every((action) => action.includes("handleOpenPayment(order)"))).toBe(true);

    // Hiding the row control must not remove access to payment management from order details.
    expect(source).toContain("onOpenPayment={handleOpenPayment}");
    expect(source).toContain("onConfirm={handleConfirmPaymentFromModal}");
  });
});
