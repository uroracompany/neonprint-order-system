/* global process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_STATUS,
  isPaymentDeliveryEligible,
  isPaymentProductionEligible,
} from "../utils/constants";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readLatestMigration = (suffix) => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith(suffix)).sort().at(-1);
  return readFileSync(join(dir, file), "utf8");
};

describe("flujo de produccion en caja", () => {
  it("permite pago parcial hacia produccion y mantiene bloqueo solo para entrega", () => {
    expect(isPaymentProductionEligible(PAYMENT_STATUS.PARTIAL)).toBe(true);
    expect(isPaymentDeliveryEligible(PAYMENT_STATUS.PARTIAL)).toBe(false);
  });

  it("mantiene a Caja fuera del envio a produccion", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    expect(quote).not.toContain("ProductionAssignmentModal");
    expect(quote).not.toContain("send_order_to_production");
    expect(quote).not.toContain("Dar paso a producción");
    expect(quote).toContain("Caja debe autorizar la orden antes de que el responsable operativo continúe a Producción.");
    expect(quote).toContain("authorize_order_for_production");
  });

  it("persiste la autorización financiera y exige factura más imagen para pagos pagados", () => {
    const migration = readLatestMigration("_payment_authorization_production_gate.sql");

    expect(migration).toContain("production_authorized_at timestamptz");
    expect(migration).toContain("production_authorized_by uuid");
    expect(migration).toContain("create or replace function public.authorize_order_for_production");
    expect(migration).toContain("public.order_has_confirmable_payment");
    expect(migration).toContain("public.quote_has_uploaded_payment_receipt");
    expect(migration).toContain("v_order.payment_status not in ('pagado', 'parcial', 'credito')");
    expect(migration).toContain("v_updated.designer_id");
    expect(migration).toContain("coalesce(v_updated.seller_id, v_updated.created_by)");
    expect(migration).toContain("La orden requiere al menos un archivo clasificado en un área de Producción activa antes de autorizarla.");
    expect(migration).toContain("Cada archivo requiere área activa, materiales y terminación válidos antes de autorizar Producción.");
  });

  it("invalida la autorización al archivar y exige una autorización nueva después de restaurar", () => {
    const migration = readLatestMigration("_payment_authorization_production_gate.sql");
    const lifecycleStart = migration.indexOf("create or replace function public.enforce_production_authorization_lifecycle()");
    const lifecycleEnd = migration.indexOf("create or replace function public.enforce_invoice_assignment_lifecycle()", lifecycleStart);
    const lifecycle = migration.slice(lifecycleStart, lifecycleEnd);
    const authorizationStart = migration.indexOf("create or replace function public.authorize_order_for_production(");
    const authorizationEnd = migration.indexOf("create or replace function public.can_send_order_to_production(", authorizationStart);
    const authorization = migration.slice(authorizationStart, authorizationEnd);

    for (const archiveField of [
      "is_archived",
      "is_archived_admin",
      "is_archived_designer",
      "is_archived_quote",
      "is_archived_production",
      "is_archived_delivery",
    ]) {
      expect(lifecycle).toContain(`not coalesce(old.${archiveField}, false) and coalesce(new.${archiveField}, false)`);
      expect(authorization).toContain(`coalesce(v_order.${archiveField}, false)`);
    }

    expect(lifecycle).toContain("before update of production_authorized_at, production_authorized_by, payment_status, status, operational_status,");
    expect(lifecycle).toContain("new.production_authorized_at := null;");
    expect(lifecycle).toContain("new.production_authorized_by := null;");
  });

  it("no confunde editar el pago con autorizar Producción", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const authorizationStart = quote.indexOf("const canAuthorizeProduction =");
    const authorizationEnd = quote.indexOf("const returnedReason", authorizationStart);
    const authorization = quote.slice(authorizationStart, authorizationEnd);

    expect(authorization).not.toContain("canManagePayment");
    expect(authorization).toContain("isPaymentProductionEligible(order?.payment_status)");
    expect(authorization).toContain("productionFilesReadyForAuthorization");
    for (const archiveField of [
      "is_archived",
      "is_archived_admin",
      "is_archived_designer",
      "is_archived_quote",
      "is_archived_production",
      "is_archived_delivery",
    ]) {
      expect(authorization).toContain(`!order?.${archiveField}`);
    }
    expect(quote).toContain("hasVerifiedPaymentReceipt(paymentModalOrder)");
  });

  it("muestra solo areas participantes en el modal de asignacion de produccion", () => {
    const modal = readProjectFile("src/components/orders/ProductionAssignmentModal.jsx");

    expect(modal).toContain("getParticipatingProductionAreaCodes");
    expect(modal).toContain("source.filter((item) => participating.includes(item.code))");
    expect(modal).toContain("hasUnclassifiedProductionFiles");
    expect(modal).toContain("Clasifica todos los archivos antes de continuar.");
    expect(modal).toContain("pq-dialog--production-assignment pq-dialog--return-designer");
    expect(modal).toContain("pq-dialog-header pq-dialog-header--delivery");
    expect(modal).toContain("pq-production-header-code");
    expect(modal).not.toContain("pq-dialog-icon production");
    expect(modal).toContain("pq-dialog-actions");
  });

  it("rehidrata archivos de produccion despues de registrar credito", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const applyCreditStart = quote.indexOf("const applyCreditToOrder = async");
    const applyCreditEnd = quote.indexOf("const openCreditClientRegistration", applyCreditStart);
    const applyCredit = quote.slice(applyCreditStart, applyCreditEnd);
    expect(quote).toContain("const fetchOrderWithProductionFiles = useCallback(async (orderId) => {");
    expect(quote).toContain("QUOTE_ORDER_SELECT");
    expect(quote).toContain("const mergeOrderWithProductionFiles = (baseOrder, nextOrder) => {");
    expect(applyCredit).toContain('rpc("mark_order_as_credit"');
    expect(applyCredit).toContain("const hydratedOrder = await fetchOrderWithProductionFiles(updatedOrder.id);");
    expect(applyCredit).toContain("mergeOrderWithProductionFiles(order, hydratedOrder || updatedOrder)");
  });

  it("define el envio a produccion desde areas participantes y rechaza areas extra", () => {
    const migration = readLatestMigration("_dynamic_production_participating_areas.sql");
    const fnStart = migration.indexOf("create or replace function public.send_order_to_production");
    const fnEnd = migration.indexOf("revoke all on function public.send_order_to_production", fnStart);
    const fn = migration.slice(fnStart, fnEnd);

    expect(fn).toContain("select distinct pa.code, pa.label, pa.producer_role");
    expect(fn).toContain("from public.order_production_files opf");
    expect(fn).toContain("jsonb_object_keys(v_area_assignments)");
    expect(fn).toContain("El area % no participa en esta orden.");
    expect(fn).not.toContain("from public.production_areas\n    where is_active = true\n    order by code");
  });

  it("autoriza localmente solo la actualizacion protegida tras validar y asignar la orden", () => {
    const migration = readLatestMigration("_send_order_to_production_command_context.sql");
    const fnStart = migration.indexOf("create or replace function public.send_order_to_production");
    const fnEnd = migration.indexOf("revoke all on function public.send_order_to_production", fnStart);
    const fn = migration.slice(fnStart, fnEnd);
    const context = "perform set_config('app.neonprint_order_command', 'on', true);";
    const orderUpdate = "update public.orders";

    expect(fn).toContain(context);
    expect(fn).toContain("for update");
    expect(fn).toContain("El area % no participa en esta orden.");
    expect(fn).toContain("update public.order_production_files opf");
    expect(fn.indexOf(context)).toBeGreaterThan(fn.indexOf("update public.order_production_files opf"));
    expect(fn.indexOf(context)).toBeLessThan(fn.indexOf(orderUpdate));
    expect(fn).toContain("returning * into updated_order;");
    expect(migration).toContain("grant execute on function public.send_order_to_production(uuid, jsonb) to authenticated;");
  });

  it("limpia solo asignaciones activas sin archivos y no notifica roles genericos de produccion", () => {
    const migration = readLatestMigration("_dynamic_production_participating_areas.sql");

    expect(migration).toContain("o.status in ('in_Production', 'in_Termination')");
    expect(migration).toContain("not exists (\n    select 1\n    from public.order_production_files opf");
    expect(migration).toContain("public.handle_order_change_notification()");
    expect(migration).toContain("Could not remove generic printer recipients");
  });

  it("mantiene visibles las acciones correctas en las tarjetas de caja", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const cardStart = quote.indexOf('<div className="ps-order-card-actions">');
    const cardEnd = quote.indexOf("</article>", cardStart);
    const cardActions = quote.slice(cardStart, cardEnd);

    expect(cardActions).toContain("Ver detalles");
    expect(cardActions).toContain("handleViewOrder(order)");
    expect(cardActions).toContain("canArchiveQuoteOrder(order, user?.id)");
    expect(cardActions).toContain("setArchivingOrder(order)");
    expect(cardActions).toContain("Archivar");
    expect(quote).toContain('<StatusBadge status={order.status} className="acm-badge" bordered showDot={false} order={order} />');
    expect(quote).toContain('<PaymentBadge status={order.payment_status} className="acm-badge" bordered showDot={false} />');
  });

  it("elimina el circulo decorativo de las metricas de caja sin quitar sus iconos", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const metricStart = quote.indexOf("function MetricCard");
    const metricEnd = quote.indexOf("const getSidebarBadge", metricStart);
    const metricCard = quote.slice(metricStart, metricEnd);

    expect(quote).not.toContain("pq-metric-glow");
    expect(metricCard).toContain("pq-metric-icon");
    expect(metricCard).not.toContain("acc.glow");
  });
});
