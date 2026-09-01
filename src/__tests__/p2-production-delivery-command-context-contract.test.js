/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const migration = read("supabase/migrations/20260827121000_production_file_status_command_context.sql");
const deliveryCommand = read("supabase/migrations/20260826123000_p0_core_workflow_storage_hardening.sql");
const productionStatusGuard = read("supabase/migrations/20260828090000_guard_authorized_production_recalculation_noop.sql");
const recalculationAccess = read("supabase/migrations/20260828084500_revoke_direct_production_recalculation.sql");
const adminProductionCommand = read("supabase/migrations/20260628145432_admin_order_intervention_workflow.sql");

describe("P2 production and delivery command context contract", () => {
  it("keeps the production-file RPC signature and all supported transitions", () => {
    expect(migration).toContain("public.update_production_file_status(");
    expect(migration).toContain("p_delivery_id uuid default null");
    expect(migration).toContain("('in_production', 'in_termination', 'completed')");
    expect(migration).toContain("Solo archivos en terminacion pueden volver a produccion.");
    expect(migration).toContain("El archivo debe estar en terminacion antes de completarse.");
  });

  it("sets the local command context after final-Delivery validation and before assigning Delivery", () => {
    const deliveryValidation = migration.indexOf("p.role = 'delivery'");
    const commandContext = migration.indexOf("perform set_config('app.neonprint_order_command', 'on', true);");
    const deliveryAssignment = migration.indexOf("update public.orders\n    set delivery_id = p_delivery_id");

    expect(deliveryValidation).toBeGreaterThan(-1);
    expect(commandContext).toBeGreaterThan(deliveryValidation);
    expect(deliveryAssignment).toBeGreaterThan(commandContext);
    expect(migration).toContain("Selecciona un usuario Delivery activo para completar el ultimo archivo.");
  });

  it("rejects cancelled and delivered orders before enabling the command context or assigning Delivery", () => {
    const lockedOrder = migration.indexOf("where id = file_row.order_id\n  for update;");
    const terminalOrderRejection = migration.indexOf("if order_row.status in ('cancelled', 'in_Delivered') then");
    const commandContext = migration.indexOf("perform set_config('app.neonprint_order_command', 'on', true);");
    const deliveryAssignment = migration.indexOf("update public.orders\n    set delivery_id = p_delivery_id");

    expect(lockedOrder).toBeGreaterThan(-1);
    expect(terminalOrderRejection).toBeGreaterThan(lockedOrder);
    expect(commandContext).toBeGreaterThan(terminalOrderRejection);
    expect(deliveryAssignment).toBeGreaterThan(commandContext);
    expect(migration).toContain("La orden ya no esta disponible para produccion.");
  });

  it("carries the authorized context through termination, completion, and return-to-production recalculation", () => {
    const commandContext = migration.indexOf("perform set_config('app.neonprint_order_command', 'on', true);");
    const fileMutation = migration.indexOf("update public.order_production_files");
    const recalculation = migration.indexOf("perform public.recalculate_order_production_status(file_row.order_id);");

    expect(commandContext).toBeGreaterThan(-1);
    expect(fileMutation).toBeGreaterThan(commandContext);
    expect(recalculation).toBeGreaterThan(commandContext);
    expect(migration).toContain("p_next_status not in ('in_production', 'in_termination', 'completed')");
    expect(migration).toContain("set status = p_next_status");
    expect(migration).toContain("p_next_status = 'completed'");
    expect(migration).toContain("p_next_status = 'in_production'");
  });

  it("does not redefine recalculation and preserves Delivery's final command context", () => {
    expect(migration).not.toContain("create or replace function public.recalculate_order_production_status");
    expect(deliveryCommand).toContain("create or replace function public.delivery_mark_order_delivered(p_order_id uuid, p_delivery_note text default null)");

    const deliveryOwnership = deliveryCommand.indexOf("v_order.delivery_id is distinct from v_actor");
    const deliveryContext = deliveryCommand.indexOf("perform set_config('app.neonprint_order_command','on',true);", deliveryOwnership);
    const deliveredUpdate = deliveryCommand.indexOf("update public.orders set status='in_Delivered'", deliveryContext);

    expect(deliveryOwnership).toBeGreaterThan(-1);
    expect(deliveryContext).toBeGreaterThan(deliveryOwnership);
    expect(deliveredUpdate).toBeGreaterThan(deliveryContext);
  });

  it("revokes direct recalculation from client roles while keeping explicit production commands available", () => {
    expect(recalculationAccess).toContain("revoke all on function public.recalculate_order_production_status(uuid)");
    expect(recalculationAccess).toContain("from public, anon, authenticated;");
    expect(recalculationAccess).not.toContain("grant execute on function public.recalculate_order_production_status");
    expect(migration).toContain("grant execute on function public.update_production_file_status(uuid, text, uuid) to authenticated;");
    expect(deliveryCommand).toContain("public.delivery_mark_order_delivered(uuid,text)");
    expect(adminProductionCommand).toContain("grant execute on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;");
  });

  it("permits a return to Production only when the validated producer command carries its local context", () => {
    const producerContext = migration.indexOf("perform set_config('app.neonprint_order_command', 'on', true);");
    const recalculation = migration.indexOf("perform public.recalculate_order_production_status(file_row.order_id);");
    const authorizedReversal = productionStatusGuard.indexOf("old.status = 'in_Termination'\n         and current_setting('app.neonprint_order_command', true) = 'on'");

    expect(producerContext).toBeGreaterThan(-1);
    expect(recalculation).toBeGreaterThan(producerContext);
    expect(authorizedReversal).toBeGreaterThan(-1);
    expect(productionStatusGuard).toContain("and old.status is distinct from 'in_Quote'");
    expect(productionStatusGuard).toContain("ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden");
  });

  it("allows an authorized in_Production recalculation no-op and rejects the same no-op without context", () => {
    const noOpStart = productionStatusGuard.indexOf("if new.status is not distinct from old.status");
    const noOpEnd = productionStatusGuard.indexOf("end if;", noOpStart);
    const noOpClause = productionStatusGuard.slice(noOpStart, noOpEnd);
    const transitionGuard = productionStatusGuard.indexOf("if new.status is distinct from old.status");

    expect(noOpStart).toBeGreaterThan(-1);
    expect(noOpClause).toContain("current_setting('app.neonprint_order_command', true) is distinct from 'on'");
    expect(noOpClause).toContain("and not public.current_profile_is_admin()");
    expect(noOpClause).toContain("raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden';");
    expect(transitionGuard).toBeGreaterThan(noOpStart);
  });
});
