import { describe, expect, it } from "vitest";
import { readProjectFile } from "../test-utils/read-project-file.js";

const page = readProjectFile("src/pages/pages-seller.jsx");
const styles = readProjectFile("src/css-components/page-seller.css");

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
