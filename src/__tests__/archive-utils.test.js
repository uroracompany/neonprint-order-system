import { describe, expect, it } from "vitest";
import { canArchiveOrder } from "../utils/archive";
import { ARCHIVE_MODULES, ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";

describe("archive payment guards", () => {
  it("blocks partial-payment orders in every archive module", () => {
    const baseOrder = {
      id: "order-1",
      status: ORDER_STATUS.IN_COMPLETED,
      payment_status: PAYMENT_STATUS.PARTIAL,
      is_archived: false,
      is_archived_admin: false,
      is_archived_designer: false,
      is_archived_quote: false,
      is_archived_delivery: false,
      order_production_user_archives: [],
    };

    expect(canArchiveOrder(baseOrder, ARCHIVE_MODULES.SELLER, "user-1")).toBe(false);
    expect(canArchiveOrder(baseOrder, ARCHIVE_MODULES.ADMIN, "user-1")).toBe(false);
    expect(canArchiveOrder(baseOrder, ARCHIVE_MODULES.DESIGNER, "user-1")).toBe(false);
    expect(canArchiveOrder(baseOrder, ARCHIVE_MODULES.QUOTE, "user-1")).toBe(false);
    expect(canArchiveOrder({ ...baseOrder, status: ORDER_STATUS.IN_DELIVERED }, ARCHIVE_MODULES.DELIVERY, "user-1")).toBe(false);
    expect(canArchiveOrder(baseOrder, ARCHIVE_MODULES.PRODUCTION, "user-1")).toBe(false);
  });

  it("keeps paid quote archiving behavior intact", () => {
    expect(canArchiveOrder({
      id: "order-1",
      payment_status: PAYMENT_STATUS.PAID,
      is_archived_quote: false,
    }, ARCHIVE_MODULES.QUOTE, "user-1")).toBe(true);
  });
});
