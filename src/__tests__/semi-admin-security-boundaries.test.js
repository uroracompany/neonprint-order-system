import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateOrderAssetAction } from "../../server/storage-gateway.js";

const migration = readFileSync(
  "supabase/migrations/20260928011837_harden_semi_admin_operational_boundaries.sql",
  "utf8",
);

describe("Semi-Admin authorization boundaries", () => {
  it("requires persisted Caja/Admin authorization before routing to Production", () => {
    const start = migration.indexOf("create or replace function public.semi_admin_route_order_to_production_v2(");
    const end = migration.indexOf("create or replace function public.semi_admin_assign_stage_responsibility(", start);
    const routeFunction = migration.slice(start, end);

    expect(routeFunction).toContain("for update");
    expect(routeFunction).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(routeFunction).toContain("v_order.production_authorized_at is null or v_order.production_authorized_by is null");
    expect(routeFunction).toContain("semi_admin_can_operate_stage(p_order_id, 'quote', null)");
    expect(routeFunction).toContain("semi_admin_route_order_to_production_v2_base(");
    expect(migration).toContain("revoke all on function public.semi_admin_route_order_to_production_v2(uuid, jsonb, timestamptz)");
  });

  it("rejects Production responsibility reassignment inside the SQL function and revokes direct RPC access", () => {
    const start = migration.indexOf("create or replace function public.semi_admin_assign_stage_responsibility(");
    const end = migration.indexOf("-- The helper remains callable", start);
    const assignmentFunction = migration.slice(start, end);

    expect(assignmentFunction).toContain("if p_stage = 'production' then");
    expect(assignmentFunction).toContain("p_stage not in ('design', 'quote', 'delivery')");
    expect(assignmentFunction).not.toContain("update public.order_production_assignments");
    expect(assignmentFunction).not.toContain("update public.order_production_files");
    expect(migration).toContain("revoke all on function public.semi_admin_assign_stage_responsibility(uuid, text, uuid, timestamptz, text)\n  from public, anon, authenticated;");
  });

  it("keeps the Production action informational until Caja/Admin authorization is persisted", () => {
    const handler = readFileSync("server/seller-order-actions-handler.js", "utf8");

    expect(handler).toContain("loaded.order.production_authorized_at && loaded.order.production_authorized_by");
    expect(handler).toContain('action?.key !== "route_production"');
    expect(handler).toContain("Caja o Administración debe autorizar la orden");
  });

  it("keeps the admin-archive flag denied across the SQL asset helper and command entry point", () => {
    expect(migration).toContain("or coalesce(v_order.is_archived_admin, false)");
    expect(migration).toContain("rename to semi_admin_update_order_with_assets_pre_archive_guard");
    expect(migration).toContain("La orden está archivada por Administración y no admite cambios de archivos.");
    expect(migration).toContain("semi_admin_update_order_with_assets_pre_archive_guard(");
  });

  it.each([
    "Pending",
    "pending",
    "in_Design",
    "In_Design",
    "in_Quote",
    "in_Production",
    "in_Termination",
    "in_Completed",
  ])("allows a participating Semi-Admin to upload order assets in %s", (status) => {
    const error = validateOrderAssetAction({
      order: { id: "order-1", status, created_by: "semi-1" },
      role: "semi_admin",
      userId: "semi-1",
      category: "design",
      action: "initiate",
    });

    expect(error).toBeNull();
  });

  it.each(["created_by", "seller_id", "designer_id", "quote_id", "delivery_id"])(
    "uses the canonical %s participation field for asset writes",
    (field) => {
      const error = validateOrderAssetAction({
        order: { id: "order-1", status: "in_Production", [field]: "semi-1" },
        role: "semi_admin",
        userId: "semi-1",
        category: "design",
        action: "complete",
      });

      expect(error).toBeNull();
    },
  );

  it.each([
    { status: "in_Delivered" },
    { status: "cancelled" },
    { status: "in_Production", operational_status: "blocked" },
    { status: "in_Production", is_archived: true },
    { status: "in_Production", is_archived_admin: true },
  ])("rejects Semi-Admin asset writes for closed or blocked orders: %o", (orderFields) => {
    const error = validateOrderAssetAction({
      order: { id: "order-1", created_by: "semi-1", ...orderFields },
      role: "semi_admin",
      userId: "semi-1",
      category: "design",
      action: "initiate",
    });

    expect(error?.status).toBe(409);
  });

  it("denies nonparticipants and preserves role-specific write boundaries", () => {
    const order = { id: "order-1", status: "in_Production", created_by: "other" };
    expect(validateOrderAssetAction({ order, role: "semi_admin", userId: "semi-1", category: "design", action: "initiate" })?.status).toBe(403);
    expect(validateOrderAssetAction({ order: { ...order, created_by: "seller-1" }, role: "seller", userId: "seller-1", category: "design", action: "initiate" })?.status).toBe(403);
  });

  it("restricts payment-invoice writes to the assigned Caja user and exact order path", () => {
    const paymentOrder = {
      id: "order-1",
      status: "in_Quote",
      quote_id: "cashier-1",
      created_by: "semi-1",
    };
    expect(validateOrderAssetAction({
      order: paymentOrder,
      role: "quote",
      userId: "cashier-1",
      category: "payment",
      action: "initiate",
    })).toBeNull();

    for (const role of ["semi_admin", "admin", "seller", "designer", "printer", "delivery"]) {
      expect(validateOrderAssetAction({
        order: paymentOrder,
        role,
        userId: "semi-1",
        category: "payment",
        action: "initiate",
      })?.status).toBe(403);
    }
    expect(validateOrderAssetAction({
      order: { ...paymentOrder, quote_id: "cashier-2" },
      role: "quote",
      userId: "cashier-1",
      category: "payment",
      action: "complete",
    })?.status).toBe(403);
    expect(validateOrderAssetAction({
      order: { ...paymentOrder, status: "in_Completed" },
      role: "quote",
      userId: "cashier-1",
      category: "payment",
      action: "complete",
    })?.status).toBe(403);
  });
});
