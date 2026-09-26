import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("acción externa Enviar a producción de Ventas", () => {
  const sellerPage = readProjectFile("src/pages/pages-seller.jsx");
  const sellerCss = readProjectFile("src/css-components/page-seller.css");

  it("conserva el guard y el flujo de asignación en tabla reciente, tabla completa y tarjeta móvil", () => {
    const productionActions = sellerPage.match(/(?:table|card)-action-btn production[\s\S]{0,500}?handleOpenSellerProductionAssignment\(o\)[\s\S]{0,240}?<Icons\.Send\s*\/>/g) || [];

    expect(sellerPage).toContain("canSellerRouteExternalOrderToProduction(o, { actorId: authUser?.id, isSemiAdmin })");
    expect(productionActions).toHaveLength(3);
    expect(productionActions.filter((action) => action.includes("table-action-btn production"))).toHaveLength(2);
    expect(productionActions.filter((action) => action.includes("card-action-btn production"))).toHaveLength(1);
    for (const action of productionActions) {
      expect(action).toContain('title="Enviar a producción"');
      expect(action).toContain('aria-label="Enviar a producción"');
      expect(action).toContain("stopPropagation()");
    }
  });

  it("define una variante azul explícita sin mezclar edición naranja ni Diseño violeta", () => {
    expect(sellerCss).toContain(".table-action-btn.production {");
    expect(sellerCss).toContain(".table-action-btn.production:hover {");
    expect(sellerCss).toContain(".card-action-btn.production {");
    expect(sellerCss).toContain(".card-action-btn.production:hover {");
    expect(sellerCss).toContain("color: #1d4ed8;");
    expect(sellerCss).toContain("border-color: #bfdbfe;");
    expect(sellerCss).toContain("background: #eff6ff;");
    expect(sellerCss).toContain("box-shadow: 0 4px 12px rgba(29, 78, 216, 0.25);");
    expect(sellerCss).toContain(".table-action-btn.design {");
    expect(sellerCss).toContain(".table-action-btn.edit {");
  });
});
