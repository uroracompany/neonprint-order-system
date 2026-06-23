import { describe, expect, it } from "vitest";
import { getProductionAreaForRole, PRODUCTION_FILE_STATUS } from "../utils/constants";
import {
  buildProductionFileRows,
  filterProductionFilesForRole,
  filterProductionOrdersForRoleParticipation,
  filterProductionOrdersByArchiveState,
  getParticipatingProductionAreaCodes,
  getProductionAssignmentForRole,
  getProductionAssignments,
  getProductionFiles,
  getProductionSummary,
  getProductionUserArchives,
  hasUnclassifiedProductionFiles,
  isOrderParticipatingInProductionRole,
  isProductionOrderArchivedForUser,
  isOrderAssignedToProductionRole,
} from "../utils/production";

describe("production file helpers", () => {
  it("maps producer roles to production areas", () => {
    expect(getProductionAreaForRole("digital_producer")).toBe("digital");
    expect(getProductionAreaForRole("dtf_producer")).toBe("dtf");
    expect(getProductionAreaForRole("ploteo_producer")).toBe("ploteo");
    expect(getProductionAreaForRole("seller")).toBeNull();
  });

  it("filters files by producer role", () => {
    const order = {
      order_production_files: [
        { id: "1", url: "https://example.com/digital.pdf", production_area_code: "digital" },
        { id: "2", url: "https://example.com/dtf.pdf", production_area_code: "dtf" },
      ],
    };

    expect(filterProductionFilesForRole(order, "digital_producer")).toHaveLength(1);
    expect(filterProductionFilesForRole(order, "digital_producer")[0].url).toContain("digital");
    expect(filterProductionFilesForRole(order, "ploteo_producer")).toEqual([]);
  });

  it("detects participating production areas from classified files only", () => {
    const files = [
      { id: "1", url: "https://example.com/digital.pdf", production_area_code: "digital" },
      { id: "2", url: "https://example.com/digital-2.pdf", production_area_code: "digital" },
      { id: "3", url: "https://example.com/dtf.pdf", production_area_code: "dtf" },
      { id: "4", url: "https://example.com/unclassified.pdf", production_area_code: null },
    ];

    expect(getParticipatingProductionAreaCodes(files)).toEqual(["digital", "dtf"]);
    expect(hasUnclassifiedProductionFiles(files)).toBe(true);
  });

  it("normalizes legacy order files when no production rows exist", () => {
    const files = getProductionFiles({
      order_file_url: JSON.stringify(["https://example.com/legacy.pdf"]),
    });

    expect(files).toEqual([
      expect.objectContaining({
        url: "https://example.com/legacy.pdf",
        production_area_code: null,
        status: PRODUCTION_FILE_STATUS.PENDING,
        isLegacy: true,
      }),
    ]);
  });

  it("builds production file rows with optional public tracking labels", () => {
    const rows = buildProductionFileRows({
      orderId: "order-1",
      urls: ["https://example.com/banner.pdf", "https://example.com/dtf.pdf"],
      files: [{ name: "banner.pdf" }, { name: "dtf.pdf" }],
      areaCodes: ["digital", "dtf"],
      publicLabels: ["Banner principal", "  "],
      userId: "user-1",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        public_label: "Banner principal",
        production_area_code: "digital",
      }),
      expect.objectContaining({
        public_label: null,
        production_area_code: "dtf",
      }),
    ]);
  });

  it("computes file status summaries", () => {
    const summary = getProductionSummary([
      { production_area_code: "digital", status: PRODUCTION_FILE_STATUS.IN_TERMINATION },
      { production_area_code: "digital", status: PRODUCTION_FILE_STATUS.COMPLETED },
      { production_area_code: null, status: PRODUCTION_FILE_STATUS.PENDING },
    ]);

    expect(summary).toEqual(expect.objectContaining({
      total: 3,
      classified: 2,
      pending: 1,
      in_termination: 1,
      completed: 1,
    }));
  });

  it("detects a producer assignment with area files", () => {
    const order = {
      order_production_assignments: [
        { id: "a1", order_id: "order-1", production_area_code: "digital", assigned_to: "user-1" },
      ],
      order_production_files: [
        { id: "f1", url: "https://example.com/digital.pdf", production_area_code: "digital" },
      ],
    };

    expect(getProductionAssignments(order)).toHaveLength(1);
    expect(getProductionAssignmentForRole(order, "digital_producer")).toEqual(
      expect.objectContaining({ assigned_to: "user-1" })
    );
    expect(isOrderAssignedToProductionRole(order, "digital_producer", "user-1")).toBe(true);
    expect(filterProductionFilesForRole(order, "digital_producer")).toHaveLength(1);
    expect(isOrderParticipatingInProductionRole(order, "digital_producer", "user-1")).toBe(true);
  });

  it("does not treat an assignment without area files as active participation", () => {
    const order = {
      order_production_assignments: [
        { id: "a1", order_id: "order-1", production_area_code: "ploteo", assigned_to: "user-3" },
      ],
      order_production_files: [
        { id: "f1", url: "https://example.com/digital.pdf", production_area_code: "digital" },
      ],
    };

    expect(isOrderAssignedToProductionRole(order, "ploteo_producer", "user-3")).toBe(true);
    expect(filterProductionFilesForRole(order, "ploteo_producer")).toEqual([]);
    expect(isOrderParticipatingInProductionRole(order, "ploteo_producer", "user-3")).toBe(false);
  });

  it("does not match another user from the same production area", () => {
    const order = {
      order_production_assignments: [
        { id: "a1", order_id: "order-1", production_area_code: "dtf", assigned_to: "assigned-user" },
      ],
    };

    expect(isOrderAssignedToProductionRole(order, "dtf_producer", "other-user")).toBe(false);
  });

  it("detects production archives only for the current user", () => {
    const order = {
      order_production_user_archives: [
        { order_id: "order-1", user_id: "user-1", archived_at: "2026-06-08T00:00:00Z" },
      ],
    };

    expect(getProductionUserArchives(order)).toHaveLength(1);
    expect(isProductionOrderArchivedForUser(order, "user-1")).toBe(true);
    expect(isProductionOrderArchivedForUser(order, "user-2")).toBe(false);
  });

  it("keeps another producer archive from affecting the current user", () => {
    const order = {
      order_production_user_archives: [
        { order_id: "order-1", user_id: "other-user" },
      ],
    };

    expect(isProductionOrderArchivedForUser(order, "current-user")).toBe(false);
  });

  it("filters active and archived production orders per user", () => {
    const orders = [
      { id: "order-1", order_production_user_archives: [{ order_id: "order-1", user_id: "user-1" }] },
      { id: "order-2", order_production_user_archives: [{ order_id: "order-2", user_id: "user-2" }] },
      { id: "order-3", order_production_user_archives: [] },
    ];

    expect(filterProductionOrdersByArchiveState(orders, "user-1", "active").map((order) => order.id))
      .toEqual(["order-2", "order-3"]);
    expect(filterProductionOrdersByArchiveState(orders, "user-1", "archived").map((order) => order.id))
      .toEqual(["order-1"]);
  });

  it("treats orders without archive rows as active", () => {
    const [order] = filterProductionOrdersByArchiveState([{ id: "order-1" }], "user-1", "active");

    expect(order.id).toBe("order-1");
    expect(filterProductionOrdersByArchiveState([{ id: "order-1" }], "user-1", "archived")).toEqual([]);
  });

  it("filters production orders to the current assigned area with files", () => {
    const orders = [
      {
        id: "order-1",
        order_production_assignments: [
          { order_id: "order-1", production_area_code: "digital", assigned_to: "digital-user" },
        ],
        order_production_files: [
          { id: "f1", url: "https://example.com/digital.pdf", production_area_code: "digital" },
        ],
      },
      {
        id: "order-2",
        order_production_assignments: [
          { order_id: "order-2", production_area_code: "ploteo", assigned_to: "ploteo-user" },
        ],
        order_production_files: [
          { id: "f2", url: "https://example.com/digital.pdf", production_area_code: "digital" },
        ],
      },
      {
        id: "order-3",
        order_production_assignments: [
          { order_id: "order-3", production_area_code: "digital", assigned_to: "other-user" },
        ],
        order_production_files: [
          { id: "f3", url: "https://example.com/digital.pdf", production_area_code: "digital" },
        ],
      },
    ];

    expect(filterProductionOrdersForRoleParticipation(orders, "digital_producer", "digital-user").map((order) => order.id))
      .toEqual(["order-1"]);
    expect(filterProductionOrdersForRoleParticipation(orders, "admin", "admin-user").map((order) => order.id))
      .toEqual(["order-1", "order-2", "order-3"]);
  });
});
