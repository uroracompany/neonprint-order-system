import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const quoteCss = readFileSync(resolve("src/css-components/page-quote.css"), "utf8");
const sellerCss = readFileSync(resolve("src/css-components/page-seller.css"), "utf8");

const getCssBlock = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return match?.[1] || "";
};

describe("Quote metric card visual parity", () => {
  it("uses the local parity tokens for its normal surface", () => {
    const metricCard = getCssBlock(quoteCss, ".pq-metric-card");

    expect(metricCard).toContain("background: var(--pq-surface);");
    expect(metricCard).toContain("border: var(--pq-card-border);");
    expect(metricCard).toContain("border-radius: var(--pq-card-radius);");
    expect(metricCard).toContain("box-shadow: var(--pq-card-shadow);");
  });

  it("keeps the hover elevation token without translating the card", () => {
    const metricCardHover = getCssBlock(quoteCss, ".pq-metric-card:hover");

    expect(metricCardHover).toContain("transform: none;");
    expect(metricCardHover).toContain("box-shadow: var(--pq-card-shadow-hover);");
  });

  it("keeps Quote tokens equivalent to the Seller card reference", () => {
    expect(quoteCss).toContain("--pq-card-border: 1px solid #dbe3ef;");
    expect(quoteCss).toContain("--pq-card-radius: 14px;");
    expect(quoteCss).toContain("--pq-card-shadow: 0 10px 28px rgba(15, 30, 64, .055);");
    expect(quoteCss).toContain("--pq-card-shadow-hover: 0 12px 30px rgba(15, 30, 64, .07);");

    expect(sellerCss).toContain("--seller-client-border: #dbe3ef;");
    expect(sellerCss).toContain("--seller-client-radius: 14px;");
    expect(sellerCss).toContain("--seller-client-shadow: 0 10px 28px rgba(15, 30, 64, .055);");
    expect(sellerCss).toContain("--seller-client-shadow-hover: 0 12px 30px rgba(15, 30, 64, .07);");
  });

  it("keeps credit summaries on the shared metric-card contour", () => {
    expect(getCssBlock(quoteCss, ".pq-credit-summary-card.pq-metric-card"))
      .toContain("min-height: 140px;");
  });
});
