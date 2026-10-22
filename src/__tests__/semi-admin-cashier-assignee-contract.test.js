import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");
const migrationPath = "supabase/migrations/20260928170942_semi_admin_quote_assignee_requires_cashier.sql";
const gatewayMigrationPath = "supabase/migrations/20260922170134_semi_admin_file_lifecycle_management.sql";
const extractFunction = (source, name) => {
  const starts = [
    source.indexOf(`create or replace function public.${name}(`),
    source.indexOf(`create function public.${name}(`),
  ].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  expect(start, `missing definition for ${name}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("$$;", start);
  expect(end, `unterminated definition for ${name}`).toBeGreaterThan(start);
  return source.slice(start, end + 3);
};

describe("Semi-Admin Cotización solo acepta perfiles Caja", () => {
  const migration = read(migrationPath);
  const assignModal = read("src/components/ui/AssignModal.jsx");
  const sellerPage = read("src/pages/pages-seller.jsx");
  const handler = read("server/seller-order-actions-handler.js");

  it("filtra los tres selectores quote de Semi-Admin por rol, vigencia y baja, sin autoasignación", () => {
    expect(assignModal).toContain('.or("employment_status.eq.true,employment_status.is.null")');
    expect(assignModal).toContain('.is("deleted_at", null)');
    expect(assignModal).toContain("allowSelfAssignment && role !== \"quote\"");

    const quoteMounts = sellerPage.split("<AssignModal").slice(1)
      .map((component) => component.slice(0, component.indexOf("/>") + 2))
      .filter((component) => component.includes('role="quote"'));
    expect(quoteMounts).toHaveLength(3);
    expect(quoteMounts.every((mount) => !mount.includes("allowSelfAssignment"))).toBe(true);
    expect(quoteMounts.filter((mount) => mount.includes("filterActive")).length).toBe(3);
  });

  it("enforce quote-only active/non-deleted assignees in every Semi-Admin SQL path", () => {
    const transition = extractFunction(migration, "semi_admin_transition_order");
    const designSend = extractFunction(migration, "semi_admin_send_design_to_quote");
    const reassignment = extractFunction(migration, "semi_admin_assign_stage_responsibility");
    const catalog = extractFunction(migration, "semi_admin_get_order_command_catalog");

    expect(transition).toContain("where id = p_target_user_id and coalesce(employment_status, true) and deleted_at is null");
    expect(transition).toContain("v_target_role is distinct from 'quote'");
    expect(transition).toContain("v_old.status not in ('Pending', 'pending')");
    expect(transition).toContain("for update");
    expect(transition).toContain("v_old.updated_at is distinct from p_expected_updated_at");
    expect(transition).toContain("insert into public.order_events");
    expect(transition).toContain("v_target_role is distinct from 'designer'");
    expect(transition).toContain("v_target_role is distinct from 'semi_admin'");
    expect(transition).toContain("and deleted_at is null");
    expect(transition).toContain("and coalesce(employment_status, true)");

    expect(designSend).toContain("v_role is distinct from 'quote'");
    expect(designSend).toContain("coalesce(employment_status, true)");
    expect(designSend).toContain("deleted_at is null");
    expect(designSend).toContain("public.assert_order_ready_for_quote(p_order_id)");
    expect(designSend).toContain("for update");
    expect(designSend).toContain("v_order.updated_at is distinct from p_expected_updated_at");

    expect(reassignment).toContain("if v_assignee_role is distinct from 'quote'");
    expect(reassignment).toContain("if v_assignee_role not in ('designer', 'semi_admin')");
    expect(reassignment).toContain("if v_assignee_role not in ('delivery', 'semi_admin')");
    expect(reassignment).toContain("p_stage = 'production'");
    expect(reassignment).toContain("for update");
    expect(reassignment).toContain("insert into public.order_events");
    expect(reassignment).toContain("public.notify_many");

    expect(catalog).toContain("where p.role = 'quote'");
    expect(catalog).toContain("coalesce(p.employment_status, true)");
    expect(catalog).toContain("p.deleted_at is null");
    expect(catalog).toContain("jsonb_set(v_catalog, '{candidates,quote}'");
    expect(catalog).toContain("semi_admin_get_order_command_catalog_before_cashier_routing");
    expect(catalog).toContain("route_production");
    expect(catalog).toContain("semi_admin_is_order_routing_responsible");
  });

  it("retains function execution boundaries and refreshes the PostgREST schema", () => {
    expect(migration).toContain("revoke all on function public.semi_admin_transition_order(uuid, text, uuid, text, timestamptz)");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("grant execute on function public.semi_admin_transition_order(uuid, text, uuid, text, timestamptz)");
    expect(migration).toContain("revoke all on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("grant execute on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)");
    expect(migration).toContain("revoke all on function public.semi_admin_get_order_command_catalog(uuid) from public, anon");
    expect(migration).toContain("grant execute on function public.semi_admin_get_order_command_catalog(uuid) to authenticated");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("keeps the transition helper behind the authenticated SECURITY DEFINER command gateway", () => {
    const gatewaySource = read(gatewayMigrationPath);
    const gateway = extractFunction(gatewaySource, "semi_admin_execute_order_command");
    const gatewayBase = extractFunction(gatewaySource, "semi_admin_execute_order_command_base");

    expect(gateway).toContain("security definer");
    expect(gateway).toContain("public.semi_admin_execute_order_command_base(p_order_id, p_action");
    expect(gatewayBase).toContain("security definer");
    expect(gatewayBase).toContain("public.semi_admin_transition_order(p_order_id, p_action");
    expect(gatewaySource).toMatch(/grant execute on function public\.semi_admin_execute_order_command\(uuid,text,jsonb,timestamptz\), public\.semi_admin_get_order_command_catalog\(uuid\) to authenticated/);
    expect(gatewaySource).toContain("revoke all on function public.semi_admin_execute_order_command_base(uuid,text,jsonb,timestamptz) from public, anon, authenticated");
  });

  it("rejects absent, inactive and deleted designer profiles in the SQL transition helper", () => {
    const transition = extractFunction(migration, "semi_admin_transition_order");

    expect(transition).toContain("where id = p_target_user_id and coalesce(employment_status, true) and deleted_at is null");
    expect(transition).toContain("v_target_role is distinct from 'designer'");
    expect(transition).toContain("v_target_role is distinct from 'semi_admin'");
  });

  it("authorizes external send_to_quote only for the assigned Semi-Admin seller or creator", () => {
    const transition = extractFunction(migration, "semi_admin_transition_order");
    const routingSource = read("supabase/migrations/20260928125133_semi_admin_payment_exclusive_and_operational_routing.sql");
    const routingHelper = extractFunction(routingSource, "semi_admin_is_order_routing_responsible");
    const batchCatalog = extractFunction(routingSource, "semi_admin_get_orders_command_catalog");
    const sendToQuote = transition.slice(transition.indexOf("if p_action = 'send_to_quote'"));

    expect(sendToQuote).toContain("v_old.order_design_type is distinct from 'EXTERNAL_DESING'");
    expect(sendToQuote).toContain("not public.semi_admin_is_order_routing_responsible(p_order_id, v_actor)");
    expect(routingHelper).toContain("p.role = 'semi_admin'");
    expect(routingHelper).toContain("coalesce(p.employment_status, true) and p.deleted_at is null");
    expect(routingHelper).toContain("o.seller_id = p_actor_id or o.created_by = p_actor_id");
    expect(batchCatalog).toContain("v_order.order_design_type = 'EXTERNAL_DESING'");
    expect(batchCatalog).toContain("v_order.seller_id = v_actor or v_order.created_by = v_actor");
    expect(handler).toContain("loaded.order.seller_id !== auth.profile.id");
    expect(handler).toContain("loaded.order.created_by !== auth.profile.id");
    expect(handler).toContain("Solo el responsable Semi-Admin de Ventas puede enviar esta orden externa a Caja.");
  });

  it("preflights role, employment and deleted status in the HTTP handler before quote writes", () => {
    const normalizedHandler = handler.replace(/\s+/g, " ");
    const sendToQuoteStart = normalizedHandler.indexOf("async function handleSendToQuote(");
    const nextHandlerStart = normalizedHandler.indexOf("async function ", sendToQuoteStart + 1);
    const sendToQuote = normalizedHandler.slice(sendToQuoteStart, nextHandlerStart);
    const assigneeCheck = sendToQuote.indexOf("assertAssigneeRole(");
    const writeCommand = sendToQuote.indexOf("callSellerOrderCommand(");

    expect(normalizedHandler).toContain('.select("id,role,employment_status,deleted_at")');
    expect(normalizedHandler).toContain("profile.employment_status === false");
    expect(handler).toContain("profile.deleted_at != null");
    expect(handler).toContain('payload.quote_user_id || payload.quoteUserId');
    expect(sendToQuote).toContain('"quote", "un usuario de caja", env, { requireNotDeleted: true }');
    expect(assigneeCheck).toBeGreaterThanOrEqual(0);
    expect(writeCommand).toBeGreaterThan(assigneeCheck);
    expect(handler).toContain('if (normalizeKey(payload.stage) !== "quote") return null;');
  });
});
