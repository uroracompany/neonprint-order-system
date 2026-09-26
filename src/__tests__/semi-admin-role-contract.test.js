import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");
const migration = read("supabase/migrations/20260902100000_semi_admin_operational_role.sql");
const workflowRepairMigration = read("supabase/migrations/20260902173000_repair_semi_admin_operational_workflow.sql");
const stageResponsibilityMigration = read("supabase/migrations/20260902180000_add_semi_admin_stage_responsibilities.sql");
const namedTransitionRpcMigration = read("supabase/migrations/20260905051828_semi_admin_named_transition_rpc_parameters.sql");
const stageTriggerCompatibilityMigration = read("supabase/migrations/20260905052746_semi_admin_stage_assignment_trigger_compatibility.sql");
const compositeResultFixMigration = read("supabase/migrations/20260905112523_fix_semi_admin_command_composite_results.sql");
const orderFlowReconciliation = read("supabase/migrations/20260905131848_reconcile_admin_semi_admin_order_flow.sql");
const clientCancelPaymentReconciliation = read("supabase/migrations/20260906110000_semi_admin_client_cancel_payment.sql");
const sellerActions = read("server/seller-order-actions-handler.js");
const sellerWorkbench = read("src/pages/pages-seller.jsx");
const assignModal = read("src/components/ui/AssignModal.jsx");
const operationalPanel = read("src/components/orders/SemiAdminOperationalPanel.jsx");
const app = read("src/App.jsx");
const lobby = read("src/pages/lobby.jsx");
const dashboard = read("src/pages/dashboard.jsx");
const employeeModule = read("src/components/employees/AdminEmployeeModule.jsx");

describe("Semi-Administrador authorization contract", () => {
  it("keeps the role separate from admin and exposes only the seller route", () => {
    expect(app).toContain('["seller", "semi_admin"]');
    expect(app).toContain('allowed={["admin"]}');
    expect(lobby).toContain('semi_admin: "/page-seller"');
    expect(dashboard).toContain('value="semi_admin"');
    expect(employeeModule).toContain('semi_admin: "Semi-Administrador"');
    expect(migration).toContain("role = 'semi_admin'");
    expect(migration).toContain("current_profile_is_order_operator");
    expect(migration).not.toContain("current_profile_is_admin() or public.current_profile_is_semi_admin()");
  });

  it("protects foreign seller and client identity at both API and SQL layers", () => {
    expect(sellerActions).toContain("ORDER_PROTECTED_FIELDS");
    expect(sellerActions).toContain("semi_admin_update_order");
    expect(migration).toContain("No puedes cambiar el cliente de una orden ajena.");
    expect(migration).toContain("v_old.seller_id is distinct from v_actor");
    expect(migration).toContain("p_new_production_files jsonb default '[]'::jsonb");
  });

  it("requires registered clients, valid production areas, and workflow preconditions", () => {
    expect(migration).toContain("Cada orden debe tener un cliente registrado activo.");
    expect(migration).toContain("production_areas");
    expect(migration).toContain("Transición de archivo no permitida.");
    expect(migration).toContain("La orden debe estar pagada o a crédito antes de entregarse.");
    expect(migration).toContain("revoke all on function public.semi_admin");
    expect(migration).toContain("order_creation_commands");
    expect(migration).toContain("on conflict(provider,bucket,object_key) do nothing");
    expect(migration).toContain("order_asset_preupload_reservations");
    expect(migration).toContain("status='bound'");
    expect(migration).toContain("p_delivery_id uuid default null");
    expect(migration).toContain("a.producer_role=p.role");
    expect(migration).toContain("material_names, termination_name");
    expect(migration).toContain("Cada archivo de producción requiere material y terminación.");
  });

  it("keeps the migration executable and guards direct RPC calls", () => {
    expect(migration).toContain("drop constraint if exists profiles_role_check");
    expect(migration).toContain("values(new.actor_id, 'info', 'Acción confirmada'");
    expect(migration).not.toContain("semi_admin_update_production_file_status(uuid,text,timestamptz), public.semi_admin_update_production_file_status");
    expect(migration).toContain("v_old.operational_status = 'blocked'");
    expect(migration).toContain("v_order.operational_status = 'blocked'");
    expect(migration).toContain("v_old.status in ('in_Quote','cancelled','in_Delivered')");
  });

  it("exposes only semi-admin operational commands through the seller API", () => {
    expect(sellerActions).not.toContain('set_payment: handleSetPayment');
    expect(sellerActions).not.toContain('mark_credit: handleMarkCredit');
    expect(sellerActions).toContain('production_file_status: handleProductionFileStatus');
    expect(sellerActions).toContain('reassign_production_file: handleReassignProductionFile');
    expect(sellerActions).toContain('production_specifications: handleProductionSpecifications');
    expect(sellerActions).toContain('mark_delivered: handleMarkDelivered');
    expect(sellerActions).toContain('operational_catalog: handleSemiAdminOperationalCatalog');
    expect(sellerActions).toContain('route_production: handleRouteProduction');
    expect(sellerActions).toContain('code: "SEMI_ADMIN_ONLY"');
    expect(sellerActions).toContain("semi_admin_operational_users");
  });

  it("wires the operational controls to the seller workbench without client editing", () => {
    expect(sellerWorkbench).toContain("SemiAdminOperationalPanel");
    expect(sellerWorkbench).toContain("lockClientIdentity={isSemiAdmin");
    expect(operationalPanel).toContain('run("mark_delivered"');
    expect(operationalPanel).toContain("onOpenProductionAssignment");
    expect(operationalPanel).not.toContain("onOpenOrderAssets");
    expect(operationalPanel).not.toContain('hasAction("manage_specifications")');
    expect(operationalPanel).toContain("onLoadCatalog");
    expect(operationalPanel).toContain('run("stage_responsibility"');
  });

  it("keeps Design actions in labelled, independent layout groups", () => {
    const operationalStyles = read("src/components/orders/SemiAdminOperationalPanel.css");
    expect(operationalPanel).toContain('sa-op-card--design');
    expect(operationalPanel).toContain('sa-op-design-action--forward');
    expect(operationalPanel).toContain('Motivo para regresar a Ventas');
    expect(operationalPanel).toContain("onOpenQuoteAssignment");
    expect(operationalPanel).not.toContain("Responsable de Caja</span><select");
    expect(operationalPanel).toContain('run("return_design_to_sales", { reason: returnReason })');
    expect(operationalPanel).toContain("const hasReturnReason = returnReason.trim().length > 0");
    expect(operationalPanel).toContain('disabled={busy || !hasReturnReason}');
    expect(operationalPanel).toContain('sa-op-button--return sa-op-button--advanced');
    expect(operationalStyles).toContain('.sa-op-design-action--forward { grid-template-columns:');
    expect(operationalStyles).toContain('.sa-op-button--return:disabled');
    expect(operationalStyles).toContain('color: #fff;');
    expect(operationalStyles).toContain('background: var(--primary);');
    expect(operationalStyles).toContain('@media (max-width: 760px)');
  });

  it("keeps responsibilities independent by stage and Production area", () => {
    expect(stageResponsibilityMigration).toContain("semi_admin_assign_stage_responsibility");
    expect(stageResponsibilityMigration).toContain("p_stage not in ('design','quote','production','delivery')");
    expect(stageResponsibilityMigration).toContain("designer_id=p_assignee_id");
    expect(stageResponsibilityMigration).toContain("quote_id=p_assignee_id");
    expect(stageResponsibilityMigration).toContain("delivery_id=p_assignee_id");
    expect(stageResponsibilityMigration).toContain("order_production_assignments");
    expect(stageResponsibilityMigration).toContain("semi_admin_stage_responsibility_changed");
    expect(stageResponsibilityMigration).toContain("Asígnate como responsable de Entrega");
  });

  it("allows an active stage-compatible Semi-Administrador and keeps self-assignment visible", () => {
    expect(assignModal).toContain("allowSelfAssignment = false");
    expect(assignModal).toContain("Asignarme a mí como responsable de");
    expect(assignModal).toContain('.eq("role", "semi_admin")');
    expect(sellerWorkbench).toContain("allowSelfAssignment={isSemiAdmin}");
    expect(sellerActions).toContain('semiAdminActor ? ["designer", "semi_admin"] : "designer"');
    expect(sellerActions).toContain('"semi_admin_execute_order_command"');
    expect(read("supabase/migrations/20260902205733_semi_admin_design_self_assignment.sql")).toContain("v_target_role is null or v_target_role not in ('designer','semi_admin')");
  });

  it("uses the actor-aware command catalogue and removes direct Semi-Admin command execution", () => {
    const reconciliation = read("supabase/migrations/20260905055145_semi_admin_stage_operation_contract.sql");
    expect(reconciliation).toContain("semi_admin_can_operate_stage");
    expect(reconciliation).toContain("can_operate_current_stage");
    expect(reconciliation).toContain("responsibility_history");
    expect(reconciliation).toContain("'candidates', v_candidates");
    expect(reconciliation).toContain("semi_admin_execute_order_command");
    expect(reconciliation).toContain("revoke execute on function public.semi_admin_transition_order");
    expect(reconciliation).toContain("revoke all on function public.semi_admin_send_design_to_quote");
    expect(reconciliation).toContain("La orden no tiene archivos de Producción.");
    expect(reconciliation).toContain("La edición comercial no está disponible en esta etapa.");
    expect(sellerActions).toContain("semi_admin_cancel_owned_unpaid_order");
    expect(sellerActions).toContain("isSemiAdminCancellableOrder");
    expect(sellerActions).toContain('"seller_id",');
    expect(sellerActions).toContain('"created_by",');
    expect(sellerWorkbench).toContain("canSemiAdminCancelOrder");
    expect(sellerWorkbench).toContain("order?.seller_id === actorId || order?.created_by === actorId");
    expect(operationalPanel).toContain("const isResponsible = Boolean(currentUserId && responsibleId === currentUserId)");
    expect(operationalPanel).toContain('hasAction("manage_design_assets")');
    expect(operationalPanel).toContain("const candidates = catalog?.candidates || {}");
  });

  it("keeps named RPC parameters aligned with the Semi-Admin transition callers", () => {
    expect(namedTransitionRpcMigration).toContain("p_order_id uuid");
    expect(namedTransitionRpcMigration).toContain("p_designer_id uuid");
    expect(namedTransitionRpcMigration).toContain("p_quote_id uuid");
    expect(namedTransitionRpcMigration).toContain("p_reason text");
    expect(namedTransitionRpcMigration).toContain("p_archived boolean");
    expect(namedTransitionRpcMigration).toContain("p_expected_updated_at timestamptz");
    expect(namedTransitionRpcMigration).toContain("notify pgrst, 'reload schema'");
    expect(namedTransitionRpcMigration).toContain("semi_admin_transition_order(p_order_id, 'send_to_designer', p_designer_id");
    expect(sellerActions).toContain("p_designer_id: assignee.profile.id");
  });

  it("keeps the legacy stage-assignment trigger compatible with Semi-Admin responsibilities", () => {
    expect(stageTriggerCompatibilityMigration).toContain("validate_order_assignment_roles");
    expect(stageTriggerCompatibilityMigration).toContain("p.role in ('designer', 'semi_admin')");
    expect(stageTriggerCompatibilityMigration).toContain("p.role in ('quote', 'semi_admin')");
    expect(stageTriggerCompatibilityMigration).toContain("p.deleted_at is null");
    expect(stageTriggerCompatibilityMigration).not.toContain("p.role = 'designer'");
  });

  it("keeps Production and Delivery on canonical operational gates", () => {
    expect(workflowRepairMigration).toContain("semi_admin_get_order_command_catalog");
    expect(workflowRepairMigration).toContain("semi_admin_route_order_to_production");
    expect(workflowRepairMigration).toContain("order_production_assignments");
    expect(workflowRepairMigration).toContain("v_order.status <> 'in_Quote'");
    expect(workflowRepairMigration).toContain("v_order.payment_status not in ('pagado', 'parcial', 'credito')");
    expect(workflowRepairMigration).toContain("returned_to_delivery_at");
    expect(workflowRepairMigration).toContain("v_handoff.returning_delivery_id");
    expect(workflowRepairMigration).toContain("La orden requiere un Delivery activo asignado");
  });

  it("does not grant the semi-admin direct client directory writes", () => {
    expect(migration).toContain("No INSERT privilege on");
    expect(migration).toContain("clients_insert_admin");
    expect(migration).not.toContain("current_profile_role() IN ('seller', 'quote', 'semi_admin')");
    expect(clientCancelPaymentReconciliation).toContain("semi_admin_create_client(p_client jsonb)");
    expect(clientCancelPaymentReconciliation).toContain("created_by)");
    expect(clientCancelPaymentReconciliation).toContain("v_actor)");
    expect(clientCancelPaymentReconciliation).toContain("revoke all on function public.semi_admin_create_client(jsonb) from public, anon");
  });

  it("offers every active Semi-Administrador as a compatible stage candidate", () => {
    expect(assignModal).toContain("const semiAdminQuery = allowSelfAssignment");
    expect(assignModal).toContain("(semiAdmins || []).forEach");
    expect(assignModal).not.toContain(".eq(\"id\", currentUserId)");
  });

  it("keeps Production exclusive to native operators while preserving Caja routing", () => {
    const productionDeliveryMigration = read("supabase/migrations/20260905110723_semi_admin_exclude_production_direct_delivery.sql");
    expect(productionDeliveryMigration).toContain("Semi-Administración may prepare a route from Caja, but never operates Production.");
    expect(productionDeliveryMigration).toContain("v_role is distinct from v_area.producer_role");
    expect(productionDeliveryMigration).toContain("Semi-Administración no puede gestionar Producción.");
    expect(productionDeliveryMigration).toContain("p_payload->>'stage' = 'production'");
    expect(productionDeliveryMigration).toContain("semi_admin_execute_order_command_base");
    expect(sellerActions).toContain("SEMI_ADMIN_PRODUCTION_FORBIDDEN");
    expect(operationalPanel).toContain("onOpenProductionAssignment");
    expect(operationalPanel).not.toContain('run("production_file_status"');
    expect(operationalPanel).not.toContain('run("reassign_production_file"');
  });

  it("allows direct Semi-Admin delivery only after canonical completion and payment", () => {
    const productionDeliveryMigration = read("supabase/migrations/20260905110723_semi_admin_exclude_production_direct_delivery.sql");
    const directDelivery = productionDeliveryMigration.slice(
      productionDeliveryMigration.indexOf("create or replace function public.semi_admin_mark_order_delivered"),
      productionDeliveryMigration.indexOf("alter function public.semi_admin_execute_order_command")
    );
    expect(directDelivery).toContain("v_old.status <> 'in_Completed'");
    expect(directDelivery).toContain("v_old.payment_status not in ('pagado', 'credito')");
    expect(directDelivery).toContain("'direct_delivery', true");
    expect(directDelivery).not.toContain("v_old.delivery_id is distinct from v_actor");
    expect(productionDeliveryMigration).toContain("if v_payment_status in ('pagado', 'credito') then");
  });

  it("removes Semi-Admin financial powers at the UI, API, and command gateway", () => {
    expect(operationalPanel).not.toContain('run("set_payment"');
    expect(operationalPanel).not.toContain('run("mark_credit"');
    expect(sellerActions).not.toContain('set_payment: handleSetPayment');
    expect(sellerActions).not.toContain('mark_credit: handleMarkCredit');
    expect(orderFlowReconciliation).toContain("Semi-Administración no puede modificar el estado de pago ni otorgar crédito.");
    expect(orderFlowReconciliation).toContain("not in ('register_payment', 'grant_credit')");
  });

  it("expands composite command results before assigning order or production-file rows", () => {
    expect(compositeResultFixMigration).toContain("create or replace function public.semi_admin_execute_order_command_base");
    expect(compositeResultFixMigration).toContain("select * into v_result from public.semi_admin_transition_order(");
    expect(compositeResultFixMigration).toContain("select * into v_file_result from public.semi_admin_update_production_file_status_v2(");
    expect(compositeResultFixMigration).not.toContain("select public.semi_admin_transition_order(");
    expect(compositeResultFixMigration).not.toContain("select public.semi_admin_update_production_file_status_v2(");
    expect(compositeResultFixMigration).toContain("revoke all on function public.semi_admin_execute_order_command_base");
  });
});
