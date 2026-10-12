import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("acción directa de Diseño Externo desde Ventas hacia Caja", () => {
  const sellerPage = readProjectFile("src/pages/pages-seller.jsx");
  const sellerCss = readProjectFile("src/css-components/page-seller.css");
  const sellerHandler = readProjectFile("server/seller-order-actions-handler.js");

  it("aparece en ambas tablas de Ventas y abre el flujo existente de asignación a Caja", () => {
    const rowActions = sellerPage.match(/renderSellerExternalQuoteAction\(o\)/g) || [];
    const actionRenderer = sellerPage.match(/const renderSellerExternalQuoteAction = \(order\) => \{([\s\S]*?)\n\s{2}\};/)?.[1] || "";

    expect(rowActions).toHaveLength(2);
    expect(actionRenderer).toContain("<Icons.Send />");
    expect(actionRenderer).not.toContain("<Icons.Money />");
    expect(sellerPage).toContain('className="table-action-btn quote"');
    expect(sellerPage).toContain('title="Enviar a Caja"');
    expect(sellerPage).toContain('aria-label="Enviar a Caja"');
    expect(sellerPage).toContain("handleSendToQuotation(order)");
    expect(sellerPage).toContain("setSendingToQuotation(order)");
    expect(sellerPage).toContain('runSellerOrderAction("send_to_quote"');
    expect(sellerPage).toContain('role="quote"');
    expect(sellerPage).toContain("onConfirm={handleConfirmSendToQuotation}");
  });

  it("limita la acción a Diseño Externo pendiente y al vendedor responsable, incluyendo bloqueo/archivo", () => {
    const predicate = sellerPage.match(/const canSellerSendExternalOrderToQuote = \(order, \{ actorId, isSemiAdmin = false \} = \{\}\) => \(([\s\S]*?)\n\);/)?.[1] || "";
    const listColumns = sellerHandler.match(/const SELLER_LIST_COLUMNS = \[([\s\S]*?)\n\]\.join\(","\);/)?.[1] || "";

    expect(predicate).toContain("!isSemiAdmin");
    expect(predicate).toContain('order?.order_design_type === "EXTERNAL_DESING"');
    expect(predicate).toContain("ORDER_STATUS.PENDING");
    expect(predicate).toContain("order?.seller_id === actorId || order?.created_by === actorId");
    expect(predicate).toContain("!order?.is_archived");
    expect(predicate).toContain('order?.operational_status !== "blocked"');
    expect(listColumns).toContain('"operational_status"');
  });

  it("usa el acento visual cian de Caja, distinto de Diseño y Producción", () => {
    expect(sellerCss).toContain(".table-action-btn.quote {");
    expect(sellerCss).toContain("color: #0284c7;");
    expect(sellerCss).toContain("background: #e0f2fe;");
    expect(sellerCss).toContain(".table-action-btn.quote:hover {");
    expect(sellerCss).toContain(".table-action-btn.design {");
    expect(sellerCss).toContain(".table-action-btn.production {");
  });
});
