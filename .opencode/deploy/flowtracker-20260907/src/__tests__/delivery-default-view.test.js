import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync("src/pages/page-delivery.jsx", "utf8");

describe("Delivery default view", () => {
  it("opens Panel de Entrega by default while preserving the orders navigation", () => {
    expect(pageSource).toContain('const [activeTab, setActiveTab] = useState("dashboard")');
    expect(pageSource).toContain('{ id: "dashboard", label: "Panel de Entrega"');
    expect(pageSource).toContain('onClick={() => setActiveTab("orders")}');
    expect(pageSource).toContain('{activeTab === "orders" && (');
  });
});
