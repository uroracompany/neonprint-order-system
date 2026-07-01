/* global process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readMigration = () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const name = readdirSync(dir)
    .filter((file) => file.endsWith("_admin_order_intervention_workflow.sql"))
    .sort()
    .at(-1);
  return readFileSync(join(dir, name), "utf8");
};
const readOptionalQuoteMigration = () => readProjectFile(
  "supabase/migrations/20260628220000_allow_unassigned_admin_route_to_quote.sql",
);
const readExternalWorkflowMigration = () => readProjectFile(
  "supabase/migrations/20260629032744_admin_external_order_advanced_workflow.sql",
);
const readPolishMigration = () => readProjectFile(
  "supabase/migrations/20260629162127_polish_admin_advanced_order_flow.sql",
);
const readReturnToQuoteMigration = () => readProjectFile(
  "supabase/migrations/20260629999999_admin_return_to_quote_and_reassign.sql",
);
const readFileAreaMigration = () => readProjectFile(
  "supabase/migrations/20260630000000_admin_reassign_file_area.sql",
);
const readInternalDesignMigration = () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const name = readdirSync(dir)
    .filter((file) => file.endsWith("_admin_internal_design_advanced_workflow.sql"))
    .sort()
    .at(-1);
  return readFileSync(join(dir, name), "utf8");
};

describe("advanced admin order interventions", () => {
  it("exposes guarded, auditable RPCs only to authenticated users", () => {
    const migration = readMigration();

    expect(migration).toContain("create or replace function public.get_admin_order_action_availability");
    expect(migration).toContain("create or replace function public.admin_intervene_order");
    expect(migration).toContain("create or replace function public.admin_update_production_file_status");
    expect(migration).toContain("p.role = 'admin'");
    expect(migration).toContain("coalesce(p.employment_status, true) = true");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.admin_intervene_order");
    expect(migration).toContain("grant execute on function public.admin_intervene_order");
  });

  it("keeps workflow invariants authoritative in Postgres", () => {
    const migration = readMigration();

    expect(migration).toContain("order_row.status in ('cancelled', 'in_Delivered')");
    expect(migration).toContain("order_row.order_design_type = 'EXTERNAL_DESING'");
    expect(migration).toContain("order_row.status <> 'in_Quote'");
    expect(migration).toContain("order_row.payment_status not in ('pagado', 'parcial', 'credito')");
    expect(migration).toContain("Falta la imagen de la orden de trabajo");
    expect(migration).toContain("Todos los archivos deben tener nombre y un area de produccion activa");
    expect(migration).toContain("Todos los archivos de Produccion deben estar completados");
    expect(migration).toContain("old.status not in ('in_Quote', 'in_Termination')");
  });

  it("makes last-file completion and delivery assignment atomic", () => {
    const migration = readMigration();

    expect(migration).toContain("for update");
    expect(migration).toContain("p_expected_updated_at");
    expect(migration).toContain("Selecciona un usuario Delivery activo para completar el ultimo archivo");
    expect(migration).toContain("update public.orders set delivery_id = p_delivery_id");
    expect(migration).toContain("perform public.recalculate_order_production_status(file_row.order_id)");
    expect(migration).toContain("file_row.status = 'completed' and p_next_status = 'in_termination'");
  });

  it("records one semantic event with reason and recipient reviews", () => {
    const migration = readMigration();

    expect(migration).toContain("'admin_intervention'");
    expect(migration).toContain("'reason_category', p_reason_category");
    expect(migration).toContain("'reason_detail', p_reason_detail");
    expect(migration).toContain("public.order_realtime_recipient_ids(p_old, p_new)");
    expect(migration).toContain("perform public.create_order_event_reviews");
    expect(migration).toContain("perform public.notify_many");
    expect(migration).toContain("current_setting('app.admin_intervention_context', true)");
  });

  it("connects the Admin panel, filters and immediate review modal", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const panel = readProjectFile("src/components/orders/AdminAdvancedOrderModal.jsx");
    const alert = readProjectFile("src/components/orders/AdminInterventionAlert.jsx");
    const hook = readProjectFile("src/hooks/useOrderEventReviews.js");
    const app = readProjectFile("src/App.jsx");

    expect(dashboard).toContain("AdminAdvancedOrderModal");
    expect(dashboard).toContain("interventionFilter");
    expect(panel).toContain('rpc("get_admin_order_actions"');
    expect(dashboard).toContain('rpc("admin_manage_order"');
    expect(panel).toContain("Acciones disponibles");
    expect(panel).toContain("Registrar o actualizar el pago de la orden");
    expect(panel).toContain("Usuario de Caja (opcional)");
    expect(dashboard).toContain("fetchAdvancedOrderForProduction");
    expect(dashboard).toContain('.select("*, order_production_files(*)")');
    expect(dashboard).toContain("openOrderSetters: [setAdvancedOrder, setPaymentModalOrder]");
    expect(hook).toContain('["admin_edited_order", "admin_intervention"]');
    expect(alert).not.toContain("Revisar luego");
    expect(app).toContain("<AdminInterventionAlert />");
  });

  it("limits the external-design case and notifies only affected users", () => {
    const migration = readExternalWorkflowMigration();

    expect(migration).toContain("create or replace function public.get_admin_external_order_actions");
    expect(migration).toContain("create or replace function public.admin_manage_external_order");
    expect(migration).toContain("set_quote_assignee");
    expect(migration).toContain("order_design_type <> 'EXTERNAL_DESING'");
    expect(migration).toContain("public.admin_external_intervention_recipient_ids");
    expect(migration).toContain("p_old.quote_id");
    expect(migration).toContain("coalesce(p_new.seller_id, p_new.created_by)");
    expect(migration).toContain("quote_blockers := public.admin_order_action_blockers");
    expect(migration).toContain("'admin_intervention'");
    expect(migration).toContain("revoke all on function public.admin_manage_external_order");
  });

  it("allows only Caja to remain unassigned while preserving role validation", () => {
    const migration = readOptionalQuoteMigration();

    expect(migration).toContain("p_target_user_id is null and p_action <> 'route_quote'");
    expect(migration).toContain("p_target_user_id is not null and not exists");
    expect(migration).toContain("p.role = expected_role");
    expect(migration).toContain("set status = 'in_Quote', quote_id = p_target_user_id");
    expect(migration).toContain("revoke all on function public.admin_intervene_order");
  });

  it("keeps admin review values readable instead of leaking UUIDs or enum keys", () => {
    const migration = readPolishMigration();
    const reviewCard = readProjectFile("src/components/orders/OrderReviewCard.jsx");

    expect(migration).toContain("create or replace function public.admin_order_profile_name");
    expect(migration).toContain("create or replace function public.admin_order_edit_value");
    expect(migration).toContain("when p_field in ('payment', 'payment_status') then case");
    expect(migration).toContain("when 'Pending' then 'Pendiente'");
    expect(migration).toContain("'Caja: ' || public.admin_order_profile_name(p_order.quote_id)");
    expect(migration).toContain("when 'EXTERNAL_DESING' then 'Diseño externo'");
    expect(migration).not.toContain("p_order.quote_id::text");
    expect(reviewCard).toContain("UUID_PATTERN");
    expect(reviewCard).toContain("Responsable asignado");
  });

  it("exposes return_to_quote and reassign_production for Production/Termination orders", () => {
    const migration = readReturnToQuoteMigration();

    expect(migration).toContain("create or replace function public.get_admin_external_order_actions");
    expect(migration).toContain("return_to_quote");
    expect(migration).toContain("reassign_production");
    expect(migration).toContain("'in_Production', 'in_Termination'");
    expect(migration).toContain("create or replace function public.admin_order_action_blockers");
    expect(migration).toContain("create or replace function public.admin_manage_external_order");
    expect(migration).toContain("production_id = null");
    expect(migration).toContain("delivery_id = null");
    expect(migration).not.toContain("update public.order_production_files");
    expect(migration).toContain("revoke all on function public.admin_manage_external_order");
    expect(migration).toContain("grant execute on function public.admin_manage_external_order");
  });

  it("keeps file management out of terminal orders and validates area assignees", () => {
    const actionsMigration = readReturnToQuoteMigration();
    const areaMigration = readFileAreaMigration();

    expect(actionsMigration).toContain("if order_row.status not in ('cancelled', 'in_Delivered') then");
    expect(areaMigration).not.toContain("v_order.order_number");
    expect(areaMigration).toContain("v_order_number := coalesce(v_order.order_code::text, left(v_order.id::text, 8))");
    expect(areaMigration).toContain("if p_new_assigned_user_id is not null then");
    expect(areaMigration).toContain("pa.code = p_new_area_code");
    expect(areaMigration).toContain("coalesce(p.employment_status, true) = true");
    expect(areaMigration).toContain("create or replace function public.admin_force_file_status");
    expect(areaMigration).toContain("p_new_status not in ('pending', 'in_production', 'in_termination', 'completed')");
    expect(areaMigration).toContain("grant execute on function public.admin_force_file_status");
  });

  it("exposes mark_delivered and return_to_completed for completed/delivered orders", () => {
    const migration = readReturnToQuoteMigration();

    expect(migration).toContain("mark_delivered");
    expect(migration).toContain("return_to_completed");
    expect(migration).toContain("order_row.status = 'in_Completed'");
    expect(migration).toContain("'key', 'mark_delivered'");
    expect(migration).toContain("order_row.status = 'in_Delivered'");
    expect(migration).toContain("'key', 'return_to_completed'");
    expect(migration).toContain("'in_Completed' then");
    expect(migration).toContain("'in_Delivered' then");
    expect(migration).toContain("set status = 'in_Completed'");
    expect(migration).toContain("set status = 'in_Delivered'");
  });

  it("generalizes Configuración avanzada for INTERNAL_DESING with unified RPCs", () => {
    const migration = readInternalDesignMigration();
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(migration).toContain("create or replace function public.get_admin_order_actions");
    expect(migration).toContain("create or replace function public.admin_manage_order");
    expect(migration).toContain("create or replace function public.admin_save_design_assets");
    expect(migration).toContain("create or replace function public._admin_validate_order_completeness");
    expect(migration).toContain("create or replace function public.admin_internal_intervention_recipient_ids");
    expect(migration).toContain("route_design");
    expect(migration).toContain("set_designer_assignee");
    expect(migration).toContain("return_to_design");
    expect(migration).toContain("assign_seller");
    expect(migration).toContain("design_assets_updated");
    expect(migration).toContain("INTERNAL_DESING");
    expect(migration).toContain("grant execute on function public.admin_manage_order");
    expect(migration).toContain("grant execute on function public.get_admin_order_actions");
    expect(migration).toContain("grant execute on function public.admin_save_design_assets");
    expect(migration).toContain("p.role = 'designer'");
    expect(migration).not.toContain("p.role = 'design'");
    expect(migration).toContain("if old_order.status <> 'in_Design' then");
    expect(migration).toContain("'requires_area_assignments', true");
    expect(dashboard).toContain('["EXTERNAL_DESING", "INTERNAL_DESING"].includes(order.order_design_type)');
  });

  it("prevents recalculate_order_production_status from escalating pre-production orders", () => {
    const migration = readInternalDesignMigration();

    expect(migration).toContain("old_order.status in ('in_Production', 'in_Termination', 'in_Completed')");
    expect(migration).toContain("perform public.recalculate_order_production_status(file_row.order_id)");
  });

  it("hides manage_files for INTERNAL_DESING orders in Pending", () => {
    const migration = readInternalDesignMigration();

    expect(migration).toContain("not (order_row.order_design_type = 'INTERNAL_DESING' and order_row.status = 'Pending')");
  });
});
