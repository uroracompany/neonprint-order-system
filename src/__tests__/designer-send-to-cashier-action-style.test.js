import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("acción Enviar a Caja de Diseño", () => {
  const designer = read("src/pages/page-designer.jsx");
  const sharedSellerCss = read("src/css-components/page-seller.css");

  it("usa el icono y el estilo azul quote de Ventas en tablas y tarjetas", () => {
    const tableActions = designer.match(/<button className="table-action-btn quote"[\s\S]*?<Icons\.Send \/>[\s\S]*?<\/button>/g) || [];
    const cardActions = designer.match(/<button className="card-action-btn quote"[\s\S]*?<Icons\.Send \/>[\s\S]*?<\/button>/g) || [];
    const actionButtons = [...tableActions, ...cardActions];

    expect(tableActions).toHaveLength(2);
    expect(cardActions).toHaveLength(1);
    for (const button of actionButtons) {
      expect(button).toContain("<Icons.Send />");
      expect(button).not.toContain("Icons.ArrowRight");
      expect(button).toContain("setSendingToQuotation(order)");
      expect(button).toContain("event.stopPropagation()");
    }

    expect(sharedSellerCss).toContain(".table-action-btn.quote {");
    expect(sharedSellerCss).toContain(".table-action-btn.quote:hover {");
    expect(sharedSellerCss).toContain(".card-action-btn.quote {");
    expect(sharedSellerCss).toContain(".card-action-btn.quote:hover {");
    expect(sharedSellerCss).toContain("color: #0284c7;");
    expect(sharedSellerCss).toContain("background: #e0f2fe;");
  });

  it("conserva el predicado de elegibilidad de Diseño para las tres acciones", () => {
    expect(designer.match(/canDesignerSendInternalOrderToQuote\(order, user\?\.id\)/g)).toHaveLength(3);
  });
});
