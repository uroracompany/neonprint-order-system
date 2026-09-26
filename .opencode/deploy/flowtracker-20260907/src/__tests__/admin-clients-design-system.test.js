import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientsCss = readFileSync(
  resolve("src/components/clients/AdminClientsModule.css"),
  "utf8",
);

describe("AdminClientsModule design-system contract", () => {
  it("uses the administration heading and descriptive-copy scale", () => {
    expect(clientsCss).toMatch(/\.acm-heading h2[\s\S]*?font-size:\s*22px;[\s\S]*?font-weight:\s*800;/);
    expect(clientsCss).toMatch(/\.acm-heading p,[\s\S]*?font-size:\s*13px;[\s\S]*?line-height:\s*1\.5;/);
  });

  it("matches the order toolbar dimensions and control typography", () => {
    expect(clientsCss).toMatch(/\.acm-filter-panel \.acm-search[\s\S]*?height:\s*46px;/);
    expect(clientsCss).toMatch(/\.acm-filter-grid[\s\S]*?repeat\(5, minmax\(124px, 1fr\)\)[\s\S]*?minmax\(190px, 1\.35fr\)/);
    expect(clientsCss).toMatch(/\.acm-filter-grid select,[\s\S]*?height:\s*40px;[\s\S]*?font:\s*600 12px\/1 'Poppins'/);
  });

  it("keeps table copy and badges on the shared application scale", () => {
    expect(clientsCss).toMatch(/\.acm-client-cell strong[\s\S]*?font-size:\s*13px;[\s\S]*?font-weight:\s*600;/);
    expect(clientsCss).toMatch(/\.acm-client-cell small,[\s\S]*?font-size:\s*11px;/);
    expect(clientsCss).toMatch(/\.acm-badge[\s\S]*?font-size:\s*11px;[\s\S]*?font-weight:\s*600;/);
  });

  it("preserves button and detail-card spacing across the global cascade", () => {
    expect(clientsCss).toMatch(/\.acm-heading \.pa-btn[\s\S]*?white-space:\s*nowrap;/);
    expect(clientsCss).toMatch(/\.pa-panel\.acm-detail-card[\s\S]*?padding:\s*16px 18px;/);
    expect(clientsCss).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.pa-panel\.acm-detail-card[\s\S]*?padding:\s*17px;/);
  });
});
