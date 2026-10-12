import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/pages-seller.jsx", "utf8");
const styles = readFileSync("src/css-components/page-seller.css", "utf8");

describe("recent orders action layout", () => {
  it("scopes the horizontal action row to the recent-orders panel", () => {
    expect(page).toContain('className="ps-panel ps-recent-orders-panel"');
    expect(styles).toMatch(
      /\.ps-recent-orders-panel \.ps-table \.td-actions > \.table-actions\s*\{[^}]*display:\s*flex;[^}]*flex-flow:\s*row nowrap;[^}]*width:\s*max-content;/s,
    );
  });

  it("prevents nested Semiadmin assignment actions from wrapping or shrinking", () => {
    expect(styles).toMatch(
      /\.ps-recent-orders-panel \.ps-table \.td-actions > \.table-actions > \.semi-admin-direct-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*flex-wrap:\s*nowrap;[^}]*min-width:\s*max-content;/s,
    );
    expect(styles).toContain(".ps-table-wrap { overflow-x: auto; }");
    expect(styles).toContain(".ps-table {\n  min-width: 760px;");
  });
});
