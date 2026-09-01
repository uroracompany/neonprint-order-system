import { describe, expect, it } from "vitest";
import { getOrderDeadlineState, isOrderOverdue } from "../utils/orderDeadline";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("order delivery deadlines", () => {
  it("marks an active order late only after its committed local calendar day", () => {
    expect(getOrderDeadlineState({ status: "in_Production", delivery_date: "2026-08-24" }, NOW)).toMatchObject({
      isOverdue: true,
      daysOverdue: 1,
    });
    expect(isOrderOverdue({ status: "in_Production", delivery_date: "2026-08-25" }, NOW)).toBe(false);
  });

  it("clears the overdue state when delivered or reprogrammed", () => {
    expect(isOrderOverdue({ status: "in_Delivered", delivery_date: "2026-08-20" }, NOW)).toBe(false);
    expect(isOrderOverdue({ status: "in_Completed", delivery_date: "2026-08-26" }, NOW)).toBe(false);
  });

  it("keeps returned active orders overdue and ignores invalid dates", () => {
    expect(isOrderOverdue({ status: "in_Design", return_reason: "Corregir", delivery_date: "2026-08-23" }, NOW)).toBe(true);
    expect(isOrderOverdue({ status: "in_Design", delivery_date: "fecha-invalida" }, NOW)).toBe(false);
  });

  it("identifies overdue orders without changing their source chronology", () => {
    const orders = [
      { id: "future", status: "in_Quote", delivery_date: "2026-08-27" },
      { id: "one-day", status: "in_Quote", delivery_date: "2026-08-24" },
      { id: "three-days", status: "in_Quote", delivery_date: "2026-08-22" },
    ];
    expect(orders.filter((order) => isOrderOverdue(order, NOW)).map((order) => order.id)).toEqual(["one-day", "three-days"]);
    expect(orders.map((order) => order.id)).toEqual(["future", "one-day", "three-days"]);
  });
});
