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

  it("exposes payment actions from every Caja order presentation", () => {
    const source = read("src/pages/page-quote.jsx");
    const occurrences = source.match(/title="Gestionar pago"/g) || [];

    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("<Icons.Receipt /> Gestionar pago");
    expect(source).toContain("className=\"card-action-btn view\" onClick={event => { event.stopPropagation(); handleOpenPayment(order); }}");
  });
});
