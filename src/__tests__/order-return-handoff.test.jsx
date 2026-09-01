import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReturnToCashierModal from "../components/orders/ReturnToCashierModal";
import { OrderReturnHandoffPanel } from "../components/orders/OrderReturnHandoff";
import { groupOrderReturnHandoffs } from "../hooks/useOrderReturnHandoffs";
import PageSeller from "../pages/pages-seller";
import PageDesigner from "../pages/page-designer";
import PageQuote from "../pages/page-quote";

const root = path.resolve(import.meta.dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("order return handoffs", () => {
  it("loads every affected workflow page", () => {
    expect(PageSeller).toBeTypeOf("function");
    expect(PageDesigner).toBeTypeOf("function");
    expect(PageQuote).toBeTypeOf("function");
  });

  it("requires a correction note before returning an order to Caja", () => {
    const onConfirm = vi.fn();
    render(
      <ReturnToCashierModal
        open
        order={{ id: "order-123", client_name: "Cliente" }}
        handoff={{ id: "handoff-1", cashier_name: "Caja Uno" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("button", { name: "Regresar a Caja" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Corrección realizada"), { target: { value: "Se corrigió el arte final." } });
    fireEvent.click(screen.getByRole("button", { name: "Regresar a Caja" }));
    expect(onConfirm).toHaveBeenCalledWith("Se corrigió el arte final.");
  });

  it("keeps the acknowledgement independent for each return handoff", () => {
    const onAcknowledge = vi.fn();
    render(
      <OrderReturnHandoffPanel
        acknowledgementHandoff={{ id: "handoff-2", recipient_name: "Vendedor", response_note: "Se actualizó el archivo." }}
        onAcknowledge={onAcknowledge}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Marcar entendido" }));
    expect(onAcknowledge).toHaveBeenCalledWith(expect.objectContaining({ id: "handoff-2" }));
  });

  it("keeps pending return labels independent for each order and recipient", () => {
    const groupedForCashier = groupOrderReturnHandoffs([
      { id: "one", order_id: "order-1", cashier_id: "cashier", recipient_id: "seller", responded_at: "2026-08-21T10:00:00Z", acknowledged_at: null },
      { id: "two", order_id: "order-2", cashier_id: "cashier", recipient_id: "designer", responded_at: null, acknowledged_at: null },
    ], "cashier");

    expect(groupedForCashier.acknowledgementByOrder).toEqual({ "order-1": expect.objectContaining({ id: "one" }) });
    expect(groupedForCashier.acknowledgementByOrder["order-2"]).toBeUndefined();

    const groupedForDesigner = groupOrderReturnHandoffs([
      { id: "two", order_id: "order-2", cashier_id: "cashier", recipient_id: "designer", responded_at: null, acknowledged_at: null },
    ], "designer");
    expect(groupedForDesigner.incomingByOrder).toEqual({ "order-2": expect.objectContaining({ id: "two" }) });
  });

  it("defines atomic and role-protected database operations", () => {
    const migration = read("..", "supabase", "migrations", "20260821110000_order_return_handoffs.sql");
    const correction = read("..", "supabase", "migrations", "20260822000000_fix_order_return_handoff_quote_columns.sql");
    const commandContext = read("..", "supabase", "migrations", "20260827030500_quote_return_order_command_context.sql");
    const cashierReturnCommandContext = read("..", "supabase", "migrations", "20260827032000_return_order_to_cashier_command_context.sql");
    expect(migration).toContain("create table if not exists public.order_return_handoffs");
    expect(migration).toContain("create or replace function public.return_quote_order_for_correction");
    expect(migration).toContain("create or replace function public.return_order_to_cashier");
    expect(migration).toContain("create or replace function public.acknowledge_order_return");
    expect(migration).toContain("No puedes responder una devolución ajena");
    expect(migration).toContain("p_correction_note");
    expect(correction).toContain("v_order.quote_id is distinct from v_actor");
    expect(correction).not.toContain("v_order.quotation_id");
    expect(correction).not.toContain("v_order.quote_user_id");

    expect(commandContext).toContain("security definer");
    expect(commandContext).toContain("for update");
    expect(commandContext).toContain("v_order.quote_id is distinct from v_actor");
    expect(commandContext).toContain("Esta orden ya tiene una devolución pendiente");
    expect(commandContext).toContain("insert into public.order_return_handoffs");
    expect(commandContext).toContain("perform set_config('app.neonprint_order_command', 'on', true)");
    expect(commandContext.indexOf("perform set_config('app.neonprint_order_command', 'on', true)"))
      .toBeLessThan(commandContext.indexOf("update public.orders"));
    expect(commandContext).toContain("grant execute on function public.return_quote_order_for_correction(uuid, text) to authenticated");

    expect(cashierReturnCommandContext).toContain("create or replace function public.return_order_to_cashier");
    expect(cashierReturnCommandContext).toContain("security definer");
    expect(cashierReturnCommandContext).toContain("where id = p_handoff_id for update");
    expect(cashierReturnCommandContext).toContain("where id = v_handoff.order_id for update");
    expect(cashierReturnCommandContext).toContain("No puedes responder una devolución ajena");
    expect(cashierReturnCommandContext).toContain("Esta devolución ya fue regresada a Caja");
    expect(cashierReturnCommandContext).toContain("La orden ya no está pendiente de corrección");
    expect(cashierReturnCommandContext).toContain("perform set_config('app.neonprint_order_command', 'on', true)");
    expect(cashierReturnCommandContext.indexOf("perform set_config('app.neonprint_order_command', 'on', true)"))
      .toBeLessThan(cashierReturnCommandContext.indexOf("update public.orders"));
    expect(cashierReturnCommandContext).toContain("update public.order_return_handoffs");
    expect(cashierReturnCommandContext).toContain("perform public.notify_many");
    expect(cashierReturnCommandContext).toContain("grant execute on function public.return_order_to_cashier(uuid, text) to authenticated");
  });
});
