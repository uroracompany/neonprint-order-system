import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/pages-seller.jsx", "utf8");

const getActionContainerContents = (className) => {
  const marker = `<div className="${className}"`;
  const containers = [];
  let searchFrom = 0;

  while (true) {
    const start = page.indexOf(marker, searchFrom);
    if (start === -1) break;

    const openingEnd = page.indexOf(">", start) + 1;
    const closingStart = page.indexOf("</div>", openingEnd);
    expect(openingEnd).toBeGreaterThan(0);
    expect(closingStart).toBeGreaterThan(openingEnd);
    containers.push(page.slice(openingEnd, closingStart));
    searchFrom = closingStart + "</div>".length;
  }

  return containers;
};

describe("Sales order View Details action order", () => {
  it("places the existing eye action first in recent, table, and card records", () => {
    const tableContainers = getActionContainerContents("table-actions");
    const cardContainers = getActionContainerContents("ps-order-card-actions");

    expect(tableContainers).toHaveLength(2);
    expect(cardContainers).toHaveLength(1);

    for (const contents of [...tableContainers, ...cardContainers]) {
      const firstAction = contents.trimStart();
      expect(firstAction).toMatch(/^<button className="(?:table|card)-action-btn view"/);
      expect(firstAction.slice(0, firstAction.indexOf("</button>") + "</button>".length)).toContain("<Icons.Eye />");
    }
  });
});
