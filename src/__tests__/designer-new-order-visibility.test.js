import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");
const sellerStyles = readFileSync(resolve("src/css-components/page-seller.css"), "utf8");

describe("designer new order visibility", () => {
  it("exposes a topbar action that opens the shared create modal", () => {
    expect(page).toContain('className="ps-topbar-new-btn"');
    expect(page).toContain('onClick={() => setShowCreate(true)}');
    expect(page).toContain("<Icons.Plus /> Nueva Orden");
  });

  it("keeps the action visible independently of the sidebar state", () => {
    expect(sellerStyles).toContain(".ps-topbar-new-btn {");
    expect(page).toContain("showCreateButton");
  });
});
