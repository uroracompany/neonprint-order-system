import { describe, expect, it } from "vitest";
import {
  getMinimumDeliveryDate,
  isDeliveryDateInPast,
  isPastDeliveryDateChange,
} from "../utils/deliveryDate";

const NOW = new Date(2026, 7, 25, 10, 0, 0);

describe("delivery date validation", () => {
  it("uses the current local calendar day as the earliest allowed date", () => {
    expect(getMinimumDeliveryDate(NOW)).toBe("2026-08-25");
    expect(isDeliveryDateInPast("2026-08-24", NOW)).toBe(true);
    expect(isDeliveryDateInPast("2026-08-25", NOW)).toBe(false);
  });

  it("allows an existing overdue order to keep its date but rejects a new past value", () => {
    expect(isPastDeliveryDateChange("2026-08-20", "2026-08-20", NOW)).toBe(false);
    expect(isPastDeliveryDateChange("2026-08-24", "2026-08-20", NOW)).toBe(true);
  });
});
