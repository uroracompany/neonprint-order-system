-- P2 requires an approved, transaction-local command context for protected
-- order updates. This return RPC validates and locks the handoff before
-- enabling that context solely for the order restoration below.
create or replace function public.return_order_to_cashier(
  p_handoff_id uuid,
  p_correction_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_handoff public.order_return_handoffs%rowtype;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_correction_note, ''))) = 0 then
    raise exception 'Debes indicar exactamente qué corregiste';
  end if;

  select * into v_handoff from public.order_return_handoffs where id = p_handoff_id for update;
  if not found then raise exception 'Devolución no encontrada'; end if;
  if v_handoff.recipient_id <> v_actor then raise exception 'No puedes responder una devolución ajena'; end if;
  if v_handoff.responded_at is not null then raise exception 'Esta devolución ya fue regresada a Caja'; end if;
  if v_handoff.acknowledged_at is not null then raise exception 'Esta devolución ya fue cerrada'; end if;

  select * into v_order from public.orders where id = v_handoff.order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_order.return_reason is null then raise exception 'La orden ya no está pendiente de corrección'; end if;

  perform set_config('app.neonprint_order_command', 'on', true);

  update public.orders
     set status = v_handoff.source_status,
         quote_id = v_handoff.cashier_id,
         return_reason = null,
         returned_to_designer_at = null
   where id = v_order.id
   returning * into v_updated;

  update public.order_return_handoffs
     set response_note = trim(p_correction_note),
         responded_by = v_actor,
         responded_at = now()
   where id = p_handoff_id;

  perform public.notify_many(
    array[v_handoff.cashier_id],
    'order_returned',
    'Orden regresada',
    'La orden fue corregida y regresada a Caja. Revisa el detalle para conocer los cambios.',
    v_order.id,
    jsonb_build_object('event_kind', 'order_returned_to_cashier', 'return_handoff_id', p_handoff_id)
  );

  return to_jsonb(v_updated);
end;
$$;

-- Preserve the RPC's authenticated-only contract.
revoke all on function public.return_order_to_cashier(uuid, text) from public, anon;
grant execute on function public.return_order_to_cashier(uuid, text) to authenticated;
