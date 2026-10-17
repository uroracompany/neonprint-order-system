import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const readProjectFile = (relativePath) => fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const operationalLists = [
  "src/pages/dashboard.jsx",
  "src/pages/pages-seller.jsx",
  "src/pages/page-designer.jsx",
  "src/pages/page-quote.jsx",
  "src/pages/page-production.jsx",
  "src/pages/page-delivery.jsx",
];

describe("global overdue order filters contract", () => {
  it("keeps overdue as a predicate and removes the shared priority sorter", () => {
    const deadlineHelper = readProjectFile("src/utils/orderDeadline.js");

    expect(deadlineHelper).toContain("export const isOrderOverdue");
    expect(deadlineHelper).not.toContain("sortOrdersByDeadlinePriority");
    operationalLists.forEach((file) => {
      expect(readProjectFile(file)).not.toContain("sortOrdersByDeadlinePriority");
    });
  });

  it("sends Administration's overdue filter to the server-side list", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const handler = readProjectFile("server/admin-list-orders-handler.js");

    expect(dashboard).toContain("operational: operationalFilter");
    expect(dashboard).toContain('{ value: "overdue", label: "Atrasadas" }');
    expect(handler).toContain('operational === "overdue"');
    expect(handler).toContain('timeZone: "America/Asuncion"');
    expect(handler).toContain('.not("delivery_date", "is", null)');
    expect(handler).toContain('.not("status", "in", "(in_Delivered,cancelled)")');
    expect(handler.indexOf('.lt("delivery_date"')).toBeLessThan(handler.indexOf('.order("created_at"'));
    expect(handler.indexOf('.order("created_at"')).toBeLessThan(handler.indexOf('.range(from, to)'));
  });

  it("adds a conjunctive overdue filter and page reset to every non-admin local list", () => {
    [
      "src/pages/page-designer.jsx",
      "src/pages/page-quote.jsx",
      "src/pages/page-production.jsx",
      "src/pages/page-delivery.jsx",
    ].forEach((file) => {
      const source = readProjectFile(file);
      expect(source).toContain('const [filterOverdue, setFilterOverdue] = useState("all")');
      expect(source).toContain('filterOverdue === "all" || isOrderOverdue(order)');
      expect(source).toContain('{ value: "overdue", label: "Atrasadas" }');
    });

    const delivery = readProjectFile("src/pages/page-delivery.jsx");
    expect(delivery).toContain("[search, filterStatus, filterClient, filterArchive, filterOverdue]");

    [
      "src/pages/page-designer.jsx",
      "src/pages/page-quote.jsx",
      "src/pages/page-production.jsx",
    ].forEach((file) => {
      expect(readProjectFile(file)).toContain("setFilterOverdue(");
      expect(readProjectFile(file)).toContain("setPage(1)");
    });
  });

  it("sends Sales overdue filtering to the authenticated server list and resets it with the toolbar", () => {
    const sellerPage = readProjectFile("src/pages/pages-seller.jsx");

    expect(sellerPage).toContain("overdue: filterOverdue === \"overdue\"");
    expect(sellerPage).toContain('id: "overdue"');
    expect(sellerPage).toContain('setFilterOverdue("all"); setPage(1);');
    expect(sellerPage).toContain("filterArchive, filterOverdue");
  });

  it("filters Sales overdue rows before exact count, created-at ordering, and range", () => {
    const handler = readProjectFile("server/seller-order-actions-handler.js");

    expect(handler).toContain('timeZone: "America/Asuncion"');
    expect(handler).toContain('payload.overdue === true ? getAsuncionDateKey(payload.now) : null');
    expect(handler).toContain('.not("delivery_date", "is", null)');
    expect(handler).toContain('.neq("status", ORDER_STATUS.IN_DELIVERED)');
    expect(handler).toContain('.neq("status", ORDER_STATUS.CANCELLED)');
    expect(handler.indexOf("applySellerListFilters")).toBeLessThan(handler.indexOf('.order("created_at", { ascending: false })'));
  });
});
