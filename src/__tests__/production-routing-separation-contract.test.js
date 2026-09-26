import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("separación de Caja y Producción", () => {
  const migration = read("supabase/migrations/20260925120000_separate_caja_production_routing.sql");
  const quote = read("src/pages/page-quote.jsx");
  const designer = read("src/pages/page-designer.jsx");
  const seller = read("src/pages/pages-seller.jsx");
  const handler = read("server/seller-order-actions-handler.js");
  const adminActions = read("src/components/orders/AdminOrderActions.jsx");
  const detailStyles = read("src/components/orders/OrderDetailModal.css");
  const assignmentAction = read("src/components/orders/OrderAssignmentAction.jsx");

  it("centraliza la autorización y excluye quote/Caja", () => {
    expect(migration).toContain("can_send_order_to_production");
    expect(migration).toContain("v_role = 'designer'");
    expect(migration).toContain("v_role = 'seller'");
    expect(migration).toContain("v_role = 'semi_admin'");
    expect(migration).toContain("cardinality(opf.material_names)");
    expect(migration).toContain("opf.termination_name");
    expect(migration).toContain("-- In particular, quote/Caja is deliberately not authorized here.");
    expect(migration).toContain("Este rol no puede enviar ordenes a produccion.");
  });

  it("retira el flujo de Producción de Caja y deja confirmación informativa", () => {
    expect(quote).not.toContain("ProductionAssignmentModal");
    expect(quote).not.toContain('rpc("send_order_to_production"');
    expect(quote).not.toContain("Dar paso a producción");
    expect(quote).toContain("Caja debe autorizar la orden antes de que el responsable operativo continúe a Producción.");
    expect(quote).toContain("Autorizar para Producción");
  });

  it("expone Producción para Diseñador interno y Ventas externo", () => {
    expect(designer).toContain("onOpenProductionAssignment");
    expect(designer).toContain('order.order_design_type === "INTERNAL_DESING"');
    expect(designer).toContain("isPaymentProductionEligible(order.payment_status)");
    expect(designer).toContain('"payment_status"');
    expect(designer).toContain('"operational_status"');
    expect(seller).toContain("handleOpenSellerProductionAssignment");
    expect(seller).toContain("onClick={() => handleOpenSellerProductionAssignment(selectedOrder)}");
    expect(seller).not.toContain("onClick={handleOpenSellerProductionAssignment}");
    expect(seller).toContain('order.order_design_type === "EXTERNAL_DESING"');
    expect(seller).toContain('runSellerOrderAction("seller_route_production"');
    expect(handler).toContain("handleSellerRouteProduction");
    expect(handler).toContain("SELLER_PRODUCTION_ROLE_FORBIDDEN");
    expect(handler).toContain('order.order_design_type !== "EXTERNAL_DESING"');
  });

  it("mantiene el envío SemiAdmin detrás de su responsabilidad existente", () => {
    expect(handler).toContain('semi_admin_route_order_to_production: "route_production"');
    expect(handler).toContain('requireSemiAdminAction(auth)');
    expect(migration).toContain("public.semi_admin_can_operate_stage(p_order_id, 'quote', null)");
  });

  it("excluye quote de los repartos operativos sin quitarlo de pagos", () => {
    expect(migration).toContain("designer_recipients || array[new.seller_id, new.created_by, actor_id] || admins || production_users");
    expect(migration).toContain("'designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || production_users'");
    expect(migration).toContain("'designer_recipients || array[new.seller_id, new.created_by, actor_id] || admins || production_users'");
  });

  it("expone el envio directo en los registros solo para ordenes elegibles", () => {
    expect(seller).toContain("canSellerRouteExternalOrderToProduction");
    expect(seller).toContain('className="table-action-btn production"');
    expect(seller).toContain('className="card-action-btn production"');
    expect(seller).toContain("handleOpenSellerProductionAssignment(o)");
    expect(designer).toContain("canDesignerRouteInternalOrderToProduction");
    expect(designer).toContain('className="table-action-btn production"');
    expect(designer).toContain("handleOpenProductionAssignment(order)");
    expect(adminActions).toContain("canRouteToProduction");
    expect(adminActions).toContain("canAuthorizeProduction");
    expect(adminActions).toContain('label: loadingAction ? "Autorizando Producción..." : "Autorizar Producción"');
    expect(adminActions).toContain("disabled: isOperationalBusy");
    expect(adminActions).toContain("aria-busy={disabled ? true : undefined}");
    expect(adminActions).toContain('label: "Enviar a producción"');
  });

  it("reutiliza el contrato visual primario en acciones de detalle", () => {
    expect(seller).toContain("pa-order-action pa-order-action-production");
    expect(detailStyles).toContain(".pa-order-action-production");
    expect(assignmentAction).toContain("pa-order-action pa-order-action-production");
  });
});
