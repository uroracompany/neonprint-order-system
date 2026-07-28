import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("KPI search design-system contract", () => {
  it("provides a reusable KPI search box with clear and result metadata", () => {
    const component = readProjectFile("src/components/kpi/KPISearchBox.jsx");

    expect(component).toContain("export default function KPISearchBox");
    expect(component).toContain("className={`kpi-search-box");
    expect(component).toContain("Icons.Search");
    expect(component).toContain("kpi-search-clear");
    expect(component).toContain("kpi-search-meta");
    expect(component).toContain('aria-label="Limpiar busqueda"');
  });

  it("styles KPI search with focus, clear button and responsive-safe sizing", () => {
    const css = readProjectFile("src/css-components/page-kpi.css");

    expect(css).toContain(".kpi-search-box");
    expect(css).toContain(".kpi-search-box:focus-within .kpi-search-control");
    expect(css).toContain(".kpi-search-clear");
    expect(css).toContain(".kpi-search-meta");
    expect(css).toContain(".kpi-search-empty-hint");
    expect(css).toContain("flex: 1 1 280px;");
    expect(css).toContain("min-width: 220px;");
  });

  it("uses normalized KPI search in client and material analytics", () => {
    const clientAnalytics = readProjectFile("src/components/kpi/KPIClientAnalytics.jsx");
    const materialAnalytics = readProjectFile("src/components/kpi/KPIMaterialsAnalytics.jsx");

    expect(clientAnalytics).toContain("import KPISearchBox from './KPISearchBox'");
    expect(clientAnalytics).toContain("matchesKpiSearch");
    expect(clientAnalytics).toContain("filterKpiClients");
    expect(clientAnalytics).not.toContain("setSelectedClientIdx");

    expect(materialAnalytics).toContain("import KPISearchBox from './KPISearchBox'");
    expect(materialAnalytics).toContain("matchesKpiSearch");
    expect(materialAnalytics).toContain("filterKpiMaterials");
    expect(materialAnalytics).not.toContain("setSelectedMaterial(");
    expect(materialAnalytics).not.toContain("setEvoMatIdx");
  });

  it("aligns seller, designer and quote timelines to the shared search pattern", () => {
    const sellerTimeline = readProjectFile("src/components/kpi/SellerActivityTimeline.jsx");
    const designerTimeline = readProjectFile("src/components/kpi/DesignerActivityTimeline.jsx");
    const quoteTimeline = readProjectFile("src/components/kpi/QuoteActivityTimeline.jsx");

    for (const source of [sellerTimeline, designerTimeline, quoteTimeline]) {
      expect(source).toContain("KPISearchBox");
      expect(source).toContain("matchesKpiSearch");
      expect(source).toContain("useDeferredValue");
      expect(source).toContain("Buscar por actividad, cliente, orden o factura");
    }
  });
});
