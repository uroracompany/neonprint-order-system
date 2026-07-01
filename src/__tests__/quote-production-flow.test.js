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

  it("actualiza la lista local y refresca silenciosamente al enviar a produccion", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const handlerStart = quote.indexOf("const handleConfirmSendToProduction = async");
    const handlerEnd = quote.indexOf("const handleConfirmArchive", handlerStart);
    const handler = quote.slice(handlerStart, handlerEnd);

    expect(handler).toContain('supabase');
    expect(handler).toContain('rpc("send_order_to_production"');
    expect(handler).toContain("const nextOrder = {");
    expect(handler).toContain("setOrders(prev => prev.map(item => item.id === nextOrder.id");
    expect(handler).toContain("setSelectedOrder(nextOrder)");
    expect(handler).toContain("setForwardToProductionOrder(null)");
    expect(handler).toContain("fetchOrdersRef.current(user.id, true)");
  });

  it("muestra solo areas participantes en el modal de asignacion de produccion", () => {
    const modal = readProjectFile("src/components/orders/ProductionAssignmentModal.jsx");

    expect(modal).toContain("getParticipatingProductionAreaCodes");
    expect(modal).toContain("source.filter((item) => participating.includes(item.code))");
    expect(modal).toContain("hasUnclassifiedProductionFiles");
    expect(modal).toContain("Clasifica todos los archivos antes de continuar.");
  });

  it("rehidrata archivos de produccion despues de credito y antes de abrir el modal", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const applyCreditStart = quote.indexOf("const applyCreditToOrder = async");
    const applyCreditEnd = quote.indexOf("const openCreditClientRegistration", applyCreditStart);
    const applyCredit = quote.slice(applyCreditStart, applyCreditEnd);
    const openModalStart = quote.indexOf("const handleOpenProductionModal = async");
    const openModalEnd = quote.indexOf("const handleConfirmSendToProduction", openModalStart);
    const openModal = quote.slice(openModalStart, openModalEnd);

    expect(quote).toContain("const fetchOrderWithProductionFiles = useCallback(async (orderId) => {");
    expect(quote).toContain('.select("*, order_production_files(*)")');
    expect(quote).toContain("const mergeOrderWithProductionFiles = (baseOrder, nextOrder) => {");
    expect(applyCredit).toContain('rpc("mark_order_as_credit"');
    expect(applyCredit).toContain("const hydratedOrder = await fetchOrderWithProductionFiles(updatedOrder.id);");
    expect(applyCredit).toContain("mergeOrderWithProductionFiles(order, hydratedOrder || updatedOrder)");
    expect(openModal).toContain("const hydratedOrder = await fetchOrderWithProductionFiles(order?.id);");
    expect(openModal).toContain("setForwardToProductionOrder(nextOrder)");
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

  it("limpia solo asignaciones activas sin archivos y no notifica roles genericos de produccion", () => {
    const migration = readLatestMigration("_dynamic_production_participating_areas.sql");

    expect(migration).toContain("o.status in ('in_Production', 'in_Termination')");
    expect(migration).toContain("not exists (\n    select 1\n    from public.order_production_files opf");
    expect(migration).toContain("public.handle_order_change_notification()");
    expect(migration).toContain("Could not remove generic printer recipients");
  });

  it("mantiene visibles las acciones correctas en las tarjetas de caja", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const cardStart = quote.indexOf('<div className="pq-order-footer">');
    const cardEnd = quote.indexOf("</article>", cardStart);
    const cardActions = quote.slice(cardStart, cardEnd);

    expect(cardActions).toContain("Ver detalles");
    expect(cardActions).toContain("handleViewOrder(order)");
    expect(cardActions).toContain("canArchiveQuoteOrder(order, user?.id)");
    expect(cardActions).toContain("setArchivingOrder(order)");
    expect(cardActions).toContain("Archivar");
  });
});
