-- The deployed orders schema uses quote_id as the Caja assignment field.
-- Keep the return RPC independent from legacy client-side aliases that are
-- not present as database columns.
create or replace function public.return_quote_order_for_correction(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := lower(coalesce(public.current_profile_role(), ''));
  v_order public.orders%rowtype;
  v_recipient_id uuid;
  v_recipient_role text;
  v_target_status text;
  v_updated public.orders%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if v_role not in ('quote', 'cashier', 'caja', 'cotizador') then
    raise exception 'Solo Caja puede devolver órdenes para corrección';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El motivo de la devolución es obligatorio';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if lower(coalesce(v_order.status, '')) <> 'in_quote' then
    raise exception 'La orden debe estar en Caja para devolverla';
  end if;
  if v_order.quote_id is distinct from v_actor then
    raise exception 'La orden no está asignada a tu bandeja de Caja';
  end if;
  if exists (select 1 from public.order_return_handoffs where order_id = p_order_id and acknowledged_at is null) then
    raise exception 'Esta orden ya tiene una devolución pendiente';
  end if;

  if v_order.order_design_type = 'EXTERNAL_DESING' then
    v_recipient_id := coalesce(v_order.seller_id, v_order.created_by);
    v_recipient_role := 'seller';
    v_target_status := 'Pending';
  else
    v_recipient_id := v_order.designer_id;
    v_recipient_role := 'designer';
    v_target_status := 'in_Design';
  end if;

  if v_recipient_id is null then raise exception 'La orden no tiene un destinatario válido para la devolución'; end if;

  insert into public.order_return_handoffs (
    order_id, cashier_id, recipient_id, recipient_role, return_reason, source_status
  ) values (
    p_order_id, v_actor, v_recipient_id, v_recipient_role, trim(p_reason), v_order.status
  );

  update public.orders
     set status = v_target_status,
         return_reason = trim(p_reason),
         returned_to_designer_at = now()
   where id = p_order_id
   returning * into v_updated;

  return to_jsonb(v_updated);
end;
$$;
