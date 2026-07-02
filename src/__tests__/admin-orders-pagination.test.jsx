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
  it("limits the filtered orders table to seven rows per page", () => {
    expect(dashboardSource).toContain("const PER_PAGE = 7;");
    expect(dashboardSource).toContain(
      "filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)",
    );
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
