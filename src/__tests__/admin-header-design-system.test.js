import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

const getCssBlock = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return match?.[1] || "";
};

describe("Admin header design-system contract", () => {
  it("keeps the administration top header white and high-contrast", () => {
    const adminCss = readProjectFile("src/css-components/page-admin.css");
    const headerBlock = getCssBlock(adminCss, ".pa-header");
    const headerIconBlock = getCssBlock(adminCss, ".pa-header .pa-icon-btn");
    const bellBlock = getCssBlock(adminCss, ".pa-header .nc-bell-btn");

    expect(headerBlock).toContain("background: #ffffff;");
    expect(headerBlock).not.toContain("linear-gradient");
    expect(headerBlock).toContain("border-bottom: 1px solid #e2e8f0;");
    expect(headerBlock).toContain("box-shadow: 0 1px 0 rgba(15, 30, 64, 0.04);");

    expect(adminCss).toContain(".pa-header .pa-kicker");
    expect(headerIconBlock).toContain("background: #ffffff;");
    expect(headerIconBlock).toContain("color: #405474;");
    expect(bellBlock).toContain("background: #ffffff;");
    expect(bellBlock).toContain("color: #405474;");
  });
});
