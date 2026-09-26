import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("acción Enviar a Diseño de Ventas", () => {
  const sellerPage = readProjectFile("src/pages/pages-seller.jsx");
  const sellerCss = readProjectFile("src/css-components/page-seller.css");

  it("usa la variante violeta y el pincel en tabla reciente, tabla completa y tarjeta móvil", () => {
    const designActions = sellerPage.match(/(?:table|card)-action-btn design[\s\S]{0,260}?setSendingToDesigner\(o\)[\s\S]{0,180}?<Icons\.Brush\s*\/>/g) || [];

    expect(designActions).toHaveLength(3);
    expect(designActions.filter((action) => action.includes("table-action-btn design"))).toHaveLength(2);
    expect(designActions.filter((action) => action.includes("card-action-btn design"))).toHaveLength(1);
    for (const action of designActions) {
      expect(action).toContain('title="Enviar a Diseño"');
      expect(action).toContain('aria-label="Enviar a Diseño"');
      expect(action).toContain("stopPropagation()");
    }
  });

  it("mantiene editar naranja y define la intensidad violeta dedicada", () => {
    expect(sellerPage).toContain('className="table-action-btn edit"');
    expect(sellerPage).toContain('className="card-action-btn edit"');
    expect(sellerCss).toContain(".table-action-btn.edit {");
    expect(sellerCss).toContain(".card-action-btn.edit {");
    expect(sellerCss).toContain(".table-action-btn.design {");
    expect(sellerCss).toContain(".table-action-btn.design:hover {");
    expect(sellerCss).toContain(".card-action-btn.design {");
    expect(sellerCss).toContain(".card-action-btn.design:hover {");
    expect(sellerCss).toContain("color: #7c3aed;");
    expect(sellerCss).toContain("border-color: #ddd6fe;");
    expect(sellerCss).toContain("background: #f5f3ff;");
    expect(sellerCss).toContain("box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25);");
  });
});
