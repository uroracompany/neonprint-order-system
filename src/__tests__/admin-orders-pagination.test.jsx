import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "../components/ui/Pagination";

const dashboardSource = readFileSync(
  resolve("src/pages/dashboard.jsx"),
  "utf8",
);

describe("admin orders pagination", () => {
  it("requests 50-row server pages and renders the returned page without local slicing", () => {
    expect(dashboardSource).toContain("const PER_PAGE = 50;");
    expect(dashboardSource).toContain("pageSize: PER_PAGE,");
    expect(dashboardSource).toContain("setOrdersTotal(Number.isFinite(Number(result?.total))");
    expect(dashboardSource).toContain("const totalPages = Math.ceil(ordersTotal / PER_PAGE) || 1;");
    expect(dashboardSource).toContain("const paginatedOrders = filteredOrders;");
    expect(dashboardSource).not.toContain(
      "filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)",
    );
    expect(dashboardSource).toContain(
      "{!loadingOrders && !loadOrdersError && (\n                <div className=\"acm-pagination-footer\">\n                  <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />",
    );
    expect(dashboardSource).not.toContain(
      "!loadingOrders && !loadOrdersError && filteredOrders.length > 0 && (",
    );
  });

  it("keeps overview metrics global instead of deriving them from the current table page", () => {
    expect(dashboardSource).toContain("const [orderOverview, setOrderOverview] = useState(null);");
    expect(dashboardSource).toContain("const requestOverview = !orderOverviewLoadedRef.current && !orderOverviewLoadingRef.current;");
    expect(dashboardSource).toContain("includeOverview: requestOverview,");
    expect(dashboardSource).toContain('getOverviewCount("pending")');
    expect(dashboardSource).not.toContain('value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.PENDING)).length');
  });

  it("keeps previous, next and numbered navigation wired to page changes", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();

    render(<Pagination currentPage={2} totalPages={3} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: /Anterior/ }));
    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(onPageChange.mock.calls).toEqual([[1], [3], [3]]);
    expect(screen.getByRole("button", { name: "2" })).toHaveClass("active");
  });

  it("hides pagination when the filtered result fits on one page", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
